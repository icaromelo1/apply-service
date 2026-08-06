import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { like, sql } from "drizzle-orm";
import type { Page } from "playwright";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { applications, jobs } from "../db/schema.js";
import type { Job } from "../types.js";
import { getBrowser, saveScreenshot } from "./browser.js";
import { avancarIntro, dismissarModais, normalize, responderEEnviar } from "./gupy-flow.js";

const ETAPA_RESPONDIVEL = /curricul|question|formul|cadastr|dados|fit cultural|mapeamento comportamental|perfil \(pda\)|alinhamento de expectativas|prefer[êe]ncia/i;
const ETAPA_HUMANA = /test|avalia|entrevista|interview|v[íi]deo|video|bate.?papo|case|desafio|oferta|proposta|admiss|integra/i;

function exigeHumano(texto: string): boolean {
  if (ETAPA_RESPONDIVEL.test(texto)) return false;
  return ETAPA_HUMANA.test(texto);
}

export interface EtapasResult {
  avancadas: number;
  aguardandoHumano: number;
  semPendencia: number;
  falhas: number;
  concluidas: number;
}

export interface EtapasOpcoes {
  ignorarCooldown?: boolean;
  maxEtapasPorVaga?: number;
}

const HORAS_ESPERA = 12;

function caminhoVisitas(): string {
  return join(config.paths.dataDir, "etapas-visitadas.json");
}

function lerVisitas(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(caminhoVisitas(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function gravarVisitas(visitas: Record<string, string>): void {
  try {
    mkdirSync(config.paths.dataDir, { recursive: true });
    writeFileSync(caminhoVisitas(), JSON.stringify(visitas));
  } catch {}
}

function emCooldown(visitas: Record<string, string>, link: string): boolean {
  const quando = visitas[link];
  if (!quando) return false;
  return Date.now() - new Date(quando).getTime() < HORAS_ESPERA * 60 * 60 * 1000;
}

type StatusApp = "queued" | "needs_review" | "applied" | "skipped" | "failed";

function anotarPorTitulo(titulo: string, nota: string, etapa?: string, status?: StatusApp): void {
  const rows = db
    .select({ id: applications.id, title: jobs.title })
    .from(applications)
    .innerJoin(jobs, sql`${jobs.id} = ${applications.jobId}`)
    .where(like(applications.method, "gupy"))
    .all();

  const alvo = rows.find((r) => normalize(r.title).toLowerCase() === normalize(titulo).toLowerCase());
  if (!alvo) return;

  db.update(applications)
    .set({
      reviewNote: nota,
      ...(etapa ? { etapa } : {}),
      ...(status ? { status } : {}),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(sql`${applications.id} = ${alvo.id}`)
    .run();
}

async function tituloDaVaga(page: Page): Promise<string> {
  for (const selector of ["h1", "h2"]) {
    const text = normalize(await page.locator(selector).first().textContent().catch(() => null));
    if (text) return text;
  }
  return "";
}

export async function resolverEtapasGupy(opcoes: EtapasOpcoes = {}): Promise<EtapasResult> {
  const maxEtapas = opcoes.maxEtapasPorVaga ?? 6;
  const result: EtapasResult = { avancadas: 0, aguardandoHumano: 0, semPendencia: 0, falhas: 0, concluidas: 0 };
  if (!existsSync(config.paths.gupySessionPath)) return result;

  const context = await (await getBrowser()).newContext({ storageState: config.paths.gupySessionPath });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    await page.goto("https://portal.gupy.io/my/applications", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    const tab = page.locator('button:has-text("Em andamento"), [role=tab]:has-text("Em andamento")').first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click().catch(() => {});
      await page.waitForTimeout(2500);
    }

    const links: string[] = [];
    for (let pagina = 0; pagina < 10; pagina++) {
      const anchors = page.locator('a:has-text("Ver andamento")');
      const anchorCount = await anchors.count();
      for (let i = 0; i < anchorCount; i++) {
        const href = await anchors.nth(i).getAttribute("href").catch(() => null);
        if (!href) continue;
        const absolute = href.startsWith("http") ? href : `https://portal.gupy.io${href}`;
        if (!links.includes(absolute)) links.push(absolute);
      }

      const proxima = page
        .locator('button[aria-label*="róxima" i]:not([disabled]), [aria-label*="next" i]:not([disabled]), a[rel=next]')
        .first();
      if (!(await proxima.isVisible().catch(() => false))) break;
      await proxima.click().catch(() => {});
      await page.waitForTimeout(2500);
    }
    const visitas = lerVisitas();
    const pendentes = opcoes.ignorarCooldown ? links : links.filter((l) => !emCooldown(visitas, l));
    console.log(
      `[etapas] ${links.length} candidatura(s) em andamento — ${pendentes.length} a checar (${links.length - pendentes.length} em cooldown)`,
    );

    for (const link of pendentes) {
      let avancadasAqui = 0;
      let ultimoTitulo = "";

      try {
        for (let volta = 0; volta < maxEtapas; volta++) {
          await page.goto(link, { waitUntil: "networkidle" });
          await page.waitForTimeout(3000);

          const titulo = await tituloDaVaga(page);
          if (titulo) ultimoTitulo = titulo;

          const acao = page
            .locator(
              ["Começar", "Responder", "Iniciar", "Continuar", "Acessar", "Realizar", "Fazer", "Preencher"]
                .flatMap((t) => [`button:visible:has-text("${t}")`, `a:visible:has-text("${t}")`])
                .join(", "),
            )
            .first();

          if (!(await acao.isVisible().catch(() => false))) {
            if (avancadasAqui === 0) {
              const botoes = page.locator("button:visible, a[role=button]:visible");
              const quantos = Math.min(await botoes.count().catch(() => 0), 10);
              const textos: string[] = [];
              for (let b = 0; b < quantos; b++) {
                const t = normalize(await botoes.nth(b).textContent().catch(() => null)).slice(0, 28);
                if (t) textos.push(t);
              }
              console.log(`[etapas][sem-acao] ${ultimoTitulo.slice(0, 45)} → botões: ${textos.join(" · ") || "nenhum"}`);
            }
            if (avancadasAqui > 0) {
              result.concluidas++;
              anotarPorTitulo(
                ultimoTitulo,
                `${avancadasAqui} etapa(s) concluída(s) — sem pendência restante`,
                "em dia",
                "applied",
              );
            } else {
              result.semPendencia++;
            }
            visitas[link] = new Date().toISOString();
            gravarVisitas(visitas);
            break;
          }

          await acao.click({ timeout: 5000 });
          await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
          await page.waitForTimeout(2000);

          const url = page.url();
          const slug = url.includes("/steps/") ? (url.split("/steps/")[1]?.split("/")[1] ?? "") : "";

          if (exigeHumano(slug) || exigeHumano(normalize(await page.textContent("h1, h2").catch(() => "")))) {
            const shot = await saveScreenshot(page, 0);
            anotarPorTitulo(
              ultimoTitulo,
              `${avancadasAqui} etapa(s) automática(s) feita(s); etapa "${slug || "teste/entrevista"}" exige você — ${shot}`,
              `aguardando você: ${slug || "teste/entrevista"}`,
              "needs_review",
            );
            result.aguardandoHumano++;
            visitas[link] = new Date().toISOString();
            gravarVisitas(visitas);
            break;
          }

          await dismissarModais(page);
          await avancarIntro(page);

          const job: Job = {
            id: `etapa-${slug}`,
            title: ultimoTitulo,
            company: "",
            location: "",
            url: link,
            source: "Gupy",
            sources: ["Gupy"],
            keyword: "",
            keywords: [],
          };

          const outcome = await responderEEnviar(page, 0, job);
          console.log(
            `[etapas] ${ultimoTitulo} · etapa ${volta + 1} (${slug || "questionário"}) → ${outcome.status}${outcome.note ? ` (${outcome.note})` : ""}`,
          );

          if (outcome.status === "applied") {
            result.avancadas++;
            avancadasAqui++;
            continue;
          }

          anotarPorTitulo(
            ultimoTitulo,
            `etapa ${slug || "questionário"} travou: ${outcome.note ?? outcome.status}`,
            `travou: ${slug || "questionário"}`,
            outcome.status === "skipped" ? "skipped" : "needs_review",
          );
          if (outcome.status === "failed") result.falhas++;
          else result.aguardandoHumano++;
          visitas[link] = new Date().toISOString();
          gravarVisitas(visitas);
          break;
        }

        if (avancadasAqui >= maxEtapas) {
          anotarPorTitulo(
            ultimoTitulo,
            `${avancadasAqui} etapas feitas seguidas — limite por execução atingido, checar no próximo ciclo`,
            "em andamento",
            "needs_review",
          );
        }
      } catch (err) {
        console.error(`[etapas] falha em ${link}:`, err instanceof Error ? err.message : err);
        result.falhas++;
      }
    }

  } finally {
    await context.close();
  }

  return result;
}
