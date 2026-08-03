import { ImapFlow } from "imapflow";
import { sql } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { applications, jobs } from "../db/schema.js";

export type Classe = "entrevista" | "teste" | "recusa" | "recebida" | "pendencia" | "outro";

export interface Resposta {
  data: Date;
  remetente: string;
  assunto: string;
  classe: Classe;
  empresa: string | null;
  applicationId: number | null;
}

const ATS = /greenhouse|gupy|lever\.co|ashbyhq|workable|smartrecruiters|kenoby|solides/i;

const REGRAS: { classe: Classe; padrao: RegExp }[] = [
  {
    classe: "entrevista",
    padrao:
      /convite para (a )?entrevista|agendar (uma )?(entrevista|conversa)|schedule (an )?interview|interview invitation|bate.?papo com|convite para conversa|next steps|pr[óo]xima etapa/i,
  },
  {
    classe: "teste",
    padrao: /teste t[ée]cnico|desafio t[ée]cnico|technical (test|assessment|challenge)|coding challenge|take.?home/i,
  },
  {
    classe: "recusa",
    padrao:
      /n[ãa]o (foi|seguiremos|prosseguir|selecionad)|infelizmente|unfortunately|not (moving forward|selected|proceed)|outro candidato|encerrad[ao]|obrigado por ter participado|decided to move forward with other/i,
  },
  {
    classe: "pendencia",
    padrao: /n[ãa]o finalizada|incomplete application|finalize sua candidatura|complete your application/i,
  },
  {
    classe: "recebida",
    padrao:
      /recebemos sua candidatura|thank you for applying|we.{0,3}ve received your application|candidatura recebida|obrigado pelo interesse/i,
  },
];

function classificar(texto: string): Classe {
  for (const regra of REGRAS) if (regra.padrao.test(texto)) return regra.classe;
  return "outro";
}

function decodificar(bruto: string): string {
  return bruto
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function textoVisivel(fonte: string): string {
  const html = fonte.slice(Math.max(0, fonte.indexOf("text/html")));
  return decodificar(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .slice(0, 4000);
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

interface Candidatura {
  id: number;
  empresa: string;
  titulo: string;
}

function carregarCandidaturas(): Candidatura[] {
  return db
    .select({ id: applications.id, empresa: jobs.company, titulo: jobs.title })
    .from(applications)
    .innerJoin(jobs, sql`${jobs.id} = ${applications.jobId}`)
    .all();
}

function casarEmpresa(texto: string, candidaturas: Candidatura[]): Candidatura | null {
  const alvo = normalizar(texto);
  const casadas = candidaturas.filter((c) => {
    const nome = normalizar(c.empresa);
    return nome.length >= 4 && alvo.includes(nome);
  });
  if (casadas.length === 0) return null;
  return casadas.reduce((maior, atual) => (atual.empresa.length > maior.empresa.length ? atual : maior));
}

export async function lerRespostas(dias = 14): Promise<Resposta[]> {
  const { emailUser, emailPassword, emailHost } = config;
  if (!emailUser || !emailPassword) throw new Error("EMAIL_USER/EMAIL_PASSWORD não configurados");

  const candidaturas = carregarCandidaturas();
  const cliente = new ImapFlow({
    host: emailHost,
    port: 993,
    secure: true,
    auth: { user: emailUser, pass: emailPassword },
    logger: false,
  });

  const respostas: Resposta[] = [];
  await cliente.connect();
  const lock = await cliente.getMailboxLock("INBOX");

  try {
    const desde = new Date(Date.now() - dias * 24 * 3600 * 1000);
    for await (const msg of cliente.fetch({ since: desde }, { envelope: true, source: true })) {
      const assunto = msg.envelope?.subject ?? "";
      const remetente = msg.envelope?.from?.[0]?.address ?? "";
      const nome = msg.envelope?.from?.[0]?.name ?? "";
      if (/security code|c[óo]digo de seguran[çc]a/i.test(assunto)) continue;

      const corpo = textoVisivel(msg.source?.toString("utf8") ?? "");
      const classe = classificar(`${assunto} ${corpo}`);

      const daFila = casarEmpresa(`${assunto} ${nome} ${corpo.slice(0, 600)}`, candidaturas);
      const relevante = classe !== "outro" && (daFila !== null || ATS.test(remetente));
      if (!relevante) continue;

      respostas.push({
        data: msg.envelope?.date ?? new Date(0),
        remetente: nome || remetente,
        assunto,
        classe,
        empresa: daFila?.empresa ?? null,
        applicationId: daFila?.id ?? null,
      });
    }
  } finally {
    lock.release();
    await cliente.logout().catch(() => {});
  }

  respostas.sort((a, b) => b.data.getTime() - a.data.getTime());
  return respostas;
}

const ETAPA_POR_CLASSE: Partial<Record<Classe, string>> = {
  entrevista: "convite para entrevista",
  teste: "teste técnico solicitado",
  recusa: "recusada pela empresa",
};

export function anotarNoPainel(respostas: Resposta[]): number {
  let anotadas = 0;
  for (const r of respostas) {
    const etapa = ETAPA_POR_CLASSE[r.classe];
    if (!etapa || !r.applicationId) continue;

    db.update(applications)
      .set({ etapa: `${etapa} (${r.data.toISOString().slice(0, 10)})`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(sql`${applications.id} = ${r.applicationId}`)
      .run();
    anotadas++;
  }
  return anotadas;
}
