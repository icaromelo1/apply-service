import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, join } from "node:path";
import { desc, eq, sql } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { applications, jobs } from "../db/schema.js";
import { detectarPlataforma } from "../appliers/plataforma.js";

const PORT = Number(process.env.REVIEW_PORT ?? 8090);
const PASSWORD = process.env.REVIEW_PASSWORD;

function checkAuth(req: IncomingMessage): boolean {
  if (!PASSWORD) return true;
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;
  return Buffer.from(header.slice(6), "base64").toString() === `icaro:${PASSWORD}`;
}

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

interface Linha {
  id: number;
  status: string;
  method: string;
  score: number;
  note: string | null;
  aderencia: number | null;
  cvPath: string | null;
  cover: string | null;
  answers: string | null;
  appliedAt: string | null;
  etapa: string | null;
  title: string;
  company: string;
  url: string;
  source: string;
}

function carregar(): Linha[] {
  return db
    .select({
      id: applications.id,
      status: applications.status,
      method: applications.method,
      score: applications.score,
      note: applications.reviewNote,
      aderencia: applications.aderencia,
      cvPath: applications.cvPath,
      cover: applications.coverLetter,
      answers: applications.answers,
      appliedAt: applications.appliedAt,
      etapa: applications.etapa,
      title: jobs.title,
      company: jobs.company,
      url: jobs.url,
      source: jobs.source,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .orderBy(desc(applications.updatedAt))
    .all();
}

function screenshotDe(note: string | null): string | null {
  const m = note?.match(/data\/screenshots\/([\w.-]+\.png)/);
  return m ? m[1] : null;
}

function card(l: Linha, tipo: "acao" | "manual" | "enviada" | "morta"): string {
  const shot = screenshotDe(l.note);
  const evidencia = shot
    ? `<a class="ev" href="/shot/${esc(shot)}" target="_blank" rel="noopener">ver evidência</a>`
    : "";

  const faltando = l.note?.includes("DADO FALTANDO")
    ? `<p class="alerta">${esc(l.note.split("—")[0] ?? l.note)}</p>`
    : l.note && tipo !== "enviada"
      ? `<p class="nota">${esc(l.note.slice(0, 220))}</p>`
      : "";

  const cover = l.cover
    ? `<details><summary>cover letter (copiar)</summary><pre>${esc(l.cover)}</pre></details>`
    : "";
  const answers = l.answers
    ? `<details><summary>respostas enviadas</summary><pre>${esc(l.answers)}</pre></details>`
    : "";

  const acoes =
    tipo === "manual"
      ? `<form method="post" action="/a/${l.id}">
           <button name="acao" value="applied">Apliquei ✓</button>
           <button name="acao" value="skipped" class="danger">Não quero ✕</button>
         </form>`
      : tipo === "acao"
        ? `<form method="post" action="/a/${l.id}">
             <button name="acao" value="applied">Resolvi ✓</button>
             <button name="acao" value="queued">Tentar de novo ↻</button>
             <button name="acao" value="skipped" class="danger">Desistir ✕</button>
           </form>`
        : "";

  const etapa = l.etapa ? `<span class="badge etapa">${esc(l.etapa)}</span>` : "";

  const selo =
    tipo === "manual"
      ? `<span class="badge manual">NÃO aplicada — aplique você</span>`
      : tipo === "enviada"
        ? `<span class="badge ok">enviada${l.appliedAt ? ` em ${l.appliedAt.slice(0, 10)}` : ""}</span>`
        : tipo === "morta"
          ? `<span class="badge morta">${esc(l.status)}</span>`
          : `<span class="badge acao">precisa de ação</span>`;

  return `<article>
    <h3>${esc(l.title)}</h3>
    <p class="emp">${esc(l.company)}</p>
    <p>${selo}${etapa}<span class="badge">${esc(detectarPlataforma(l.url) !== "desconhecida" ? detectarPlataforma(l.url) : l.source)}</span><span class="badge">score ${l.score}</span>
       ${l.aderencia !== null ? `<span class="badge ${l.aderencia >= 75 ? "ok" : "acao"}">aderência ${l.aderencia}%</span>` : ""}
       <a href="${esc(l.url)}" target="_blank" rel="noopener">abrir vaga ↗</a> ${evidencia}
       ${l.cvPath ? `<a href="/cv/${l.id}" target="_blank" rel="noopener">CV usado ↓</a>` : ""}</p>
    ${faltando}${cover}${answers}${acoes}
  </article>`;
}

function pagina(): string {
  const todas = carregar();

  const manual = todas.filter((l) => l.method === "digest" && !["applied", "skipped"].includes(l.status));
  const acao = todas.filter(
    (l) => l.method !== "digest" && l.status === "needs_review" && !/encerrada|não encontrado/i.test(l.note ?? ""),
  );
  const enviadas = todas.filter((l) => l.status === "applied");
  const mortas = todas.filter(
    (l) => l.status === "failed" || (l.status === "needs_review" && /encerrada|não encontrado/i.test(l.note ?? "")),
  );

  const secao = (titulo: string, sub: string, lista: Linha[], tipo: "acao" | "manual" | "enviada" | "morta") =>
    lista.length === 0
      ? ""
      : `<section><h2>${titulo} <span class="cont">${lista.length}</span></h2><p class="sub">${sub}</p>${lista
          .map((l) => card(l, tipo))
          .join("")}</section>`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>apply-service</title>
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;max-width:840px;margin:0 auto;padding:1.5rem 1rem 4rem;
       background:#0f1115;color:#e6e6e6;line-height:1.5}
  h1{font-size:1.4rem;margin:0 0 .3rem}
  .resumo{color:#9aa4b2;font-size:.9rem;margin-bottom:2rem}
  h2{font-size:1.05rem;margin:2.2rem 0 .2rem;display:flex;align-items:center;gap:.5rem}
  .cont{background:#2a3140;color:#cbd5e1;border-radius:999px;padding:1px 9px;font-size:.8rem;font-weight:400}
  .sub{color:#8b95a5;font-size:.85rem;margin:0 0 1rem}
  article{border:1px solid #262c38;border-radius:10px;padding:.9rem 1rem;margin-bottom:.8rem;background:#161a22}
  h3{margin:0 0 .15rem;font-size:1rem;font-weight:600}
  .emp{margin:0 0 .5rem;color:#9aa4b2;font-size:.88rem}
  .badge{background:#242b38;border-radius:5px;padding:2px 8px;font-size:.75rem;margin-right:6px;
         display:inline-block;color:#c3ccd9}
  .badge.ok{background:#14532d;color:#bbf7d0}
  .badge.manual{background:#7c2d12;color:#fed7aa}
  .badge.etapa{background:#1e3a5f;color:#bfdbfe;margin-left:6px}
  .badge.acao{background:#78350f;color:#fde68a}
  .badge.morta{background:#3f1d1d;color:#fca5a5}
  a{color:#7ab7ff;font-size:.85rem;text-decoration:none;margin-right:10px}
  a:hover{text-decoration:underline}
  .alerta{background:#3b2f14;border-left:3px solid #f59e0b;padding:.5rem .7rem;border-radius:4px;
          font-size:.85rem;color:#fde68a;margin:.5rem 0}
  .nota{color:#94a3b8;font-size:.82rem;margin:.4rem 0}
  details{margin:.4rem 0}
  summary{cursor:pointer;color:#93c5fd;font-size:.82rem}
  pre{white-space:pre-wrap;background:#0d1017;padding:.7rem;border-radius:6px;font-size:.8rem;
      max-height:260px;overflow:auto;border:1px solid #222833}
  form{margin-top:.7rem;display:flex;gap:.5rem;flex-wrap:wrap}
  button{padding:.42rem .9rem;border-radius:7px;border:1px solid #2f3a4d;background:#1c3d2a;color:#d1fae5;
         cursor:pointer;font-size:.85rem}
  button[value="queued"]{background:#1e293b;color:#cbd5e1}
  .danger{background:#3f1d1d;color:#fecaca}
  button:hover{filter:brightness(1.25)}
</style></head><body>
<h1>apply-service</h1>
<p class="resumo">${enviadas.length} enviadas · ${acao.length} precisam de ação · ${manual.length} para aplicar manualmente</p>
${secao("Precisam de ação", "Candidaturas travadas — falta um dado seu ou o formulário não fechou.", acao, "acao")}
${secao("Aplique você mesmo", "Vagas de LinkedIn/Indeed. O serviço NÃO se candidata nelas — só reúne e escreve a cover letter. Clicar em “abrir vaga” leva ao anúncio; a candidatura é sua.", manual, "manual")}
${secao("Enviadas automaticamente", "Candidaturas concluídas pelo serviço, com evidência da tela de confirmação.", enviadas, "enviada")}
${secao("Encerradas e falhas", "Vagas que saíram do ar ou falharam de forma definitiva.", mortas, "morta")}
</body></html>`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

export function startReviewServer(): void {
  const server = createServer(async (req, res) => {
    if (!checkAuth(req)) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="apply-service"' });
      res.end("auth requerida");
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(pagina());
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/shot/")) {
      const arquivo = basename(decodeURIComponent(url.pathname.slice("/shot/".length)));
      const caminho = join(config.paths.screenshotsDir, arquivo);
      if (existsSync(caminho)) {
        res.writeHead(200, { "Content-Type": "image/png" });
        createReadStream(caminho).pipe(res);
      } else {
        res.writeHead(404);
        res.end("screenshot não encontrado");
      }
      return;
    }

    const cvMatch = url.pathname.match(/^\/cv\/(\d+)$/);
    if (req.method === "GET" && cvMatch) {
      const linha = carregar().find((l) => l.id === Number(cvMatch[1]));
      if (linha?.cvPath && existsSync(linha.cvPath)) {
        res.writeHead(200, { "Content-Type": "application/pdf" });
        createReadStream(linha.cvPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end("CV não encontrado");
      }
      return;
    }

    const match = url.pathname.match(/^\/a\/(\d+)$/);
    if (req.method === "POST" && match) {
      const id = Number(match[1]);
      const acao = new URLSearchParams(await readBody(req)).get("acao");
      if (acao === "applied" || acao === "queued" || acao === "skipped") {
        db.update(applications)
          .set({
            status: acao,
            updatedAt: sql`CURRENT_TIMESTAMP`,
            appliedAt: acao === "applied" ? sql`CURRENT_TIMESTAMP` : null,
          })
          .where(eq(applications.id, id))
          .run();
      }
      res.writeHead(303, { Location: "/" });
      res.end();
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });

  server.listen(PORT, () => console.log(`review UI em http://localhost:${PORT}`));
}

if (process.argv[1]?.includes("review/server")) {
  startReviewServer();
}
