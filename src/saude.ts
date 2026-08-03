import { sql } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { applications } from "./db/schema.js";

export interface Sinal {
  gravidade: "alerta" | "info";
  texto: string;
}

async function avisar(linhas: string[]): Promise<void> {
  const corpo = linhas.join("\n");
  if (!config.discordWebhookUrl) {
    console.log(corpo);
    return;
  }
  await fetch(config.discordWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: corpo }),
  }).catch(() => {});
}

function contarPorStatus(desde: string): Record<string, number> {
  const linhas = db
    .select({ status: applications.status, total: sql<number>`count(*)` })
    .from(applications)
    .where(sql`${applications.updatedAt} >= ${desde}`)
    .groupBy(applications.status)
    .all();
  return Object.fromEntries(linhas.map((l) => [l.status, Number(l.total)]));
}

function layoutsDesconhecidos(desde: string): number {
  const [linha] = db
    .select({ total: sql<number>`count(*)` })
    .from(applications)
    .where(
      sql`${applications.updatedAt} >= ${desde} and ${applications.reviewNote} like '%fora do padrão%'`,
    )
    .all();
  return Number(linha?.total ?? 0);
}

export async function checarSaude(): Promise<Sinal[]> {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
  const porStatus = contarPorStatus(desde);

  const enviadas = porStatus.applied ?? 0;
  const falhas = porStatus.failed ?? 0;
  const revisao = porStatus.needs_review ?? 0;
  const descartadas = porStatus.skipped ?? 0;
  const tentativas = enviadas + falhas + revisao + descartadas;

  const sinais: Sinal[] = [];

  if (tentativas === 0) {
    sinais.push({ gravidade: "alerta", texto: "Nenhuma candidatura processada nas últimas 24h — pipeline parado." });
  } else {
    const taxaFalha = (falhas + revisao) / tentativas;
    if (taxaFalha >= 0.7) {
      sinais.push({
        gravidade: "alerta",
        texto: `Taxa de insucesso em ${Math.round(taxaFalha * 100)}% (${falhas} falhas, ${revisao} para revisar, ${enviadas} enviadas).`,
      });
    }
  }

  const desconhecidos = layoutsDesconhecidos(desde);
  if (desconhecidos >= 3) {
    sinais.push({
      gravidade: "alerta",
      texto: `${desconhecidos} formulários fora do layout conhecido nas últimas 24h — provável mudança de DOM.`,
    });
  }

  if (sinais.length === 0) {
    sinais.push({
      gravidade: "info",
      texto: `Saúde ok: ${enviadas} enviadas, ${revisao} para revisar, ${descartadas} descartadas, ${falhas} falhas (24h).`,
    });
  }

  return sinais;
}

export async function reportarSaude(): Promise<Sinal[]> {
  const sinais = await checarSaude();
  const alertas = sinais.filter((s) => s.gravidade === "alerta");

  if (alertas.length > 0) {
    await avisar(["**⚠️ apply-service — atenção**", ...alertas.map((a) => `• ${a.texto}`), config.painelUrl ?? ""]);
  }

  for (const sinal of sinais) console.log(`[saude] ${sinal.gravidade}: ${sinal.texto}`);
  return sinais;
}
