import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { applications, jobs } from "../db/schema.js";

const PORT = Number(process.env.REVIEW_PORT ?? 8090);
const PASSWORD = process.env.REVIEW_PASSWORD;

function unauthorized(res: ServerResponse): void {
  res.writeHead(401, { "WWW-Authenticate": 'Basic realm="apply-service"' });
  res.end("auth requerida");
}

function checkAuth(req: IncomingMessage): boolean {
  if (!PASSWORD) return true;
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString();
  return decoded === `icaro:${PASSWORD}`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderPage(): string {
  const rows = db
    .select({ application: applications, job: jobs })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(inArray(applications.status, ["needs_review", "queued"]))
    .all();

  const cards = rows
    .map(({ application, job }) => {
      const answers = application.answers
        ? `<details><summary>Respostas</summary><pre>${escapeHtml(application.answers)}</pre></details>`
        : "";
      const cover = application.coverLetter
        ? `<details><summary>Cover letter</summary><pre>${escapeHtml(application.coverLetter)}</pre></details>`
        : "";
      const note = application.reviewNote
        ? `<p class="note">${escapeHtml(application.reviewNote)}</p>`
        : "";
      return `<article>
        <h2>${escapeHtml(job.title)} <small>— ${escapeHtml(job.company)}</small></h2>
        <p>
          <span class="badge">${application.status}</span>
          <span class="badge">${application.method}</span>
          <span class="badge">score ${application.score}</span>
          <a href="${escapeHtml(job.url)}" target="_blank" rel="noopener">abrir vaga ↗</a>
        </p>
        ${note}${answers}${cover}
        <form method="post" action="/applications/${application.id}">
          <button name="action" value="applied">Apliquei ✓</button>
          <button name="action" value="queued">Reenfileirar</button>
          <button name="action" value="skipped" class="danger">Pular ✕</button>
        </form>
      </article>`;
    })
    .join("\n");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>apply-service — review</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;background:#111;color:#eee}
  article{border:1px solid #333;border-radius:8px;padding:1rem;margin-bottom:1rem;background:#1a1a1a}
  h2{margin:0 0 .5rem;font-size:1.05rem} small{color:#999}
  .badge{background:#333;border-radius:4px;padding:2px 8px;font-size:.8rem;margin-right:6px}
  a{color:#7ab7ff} pre{white-space:pre-wrap;background:#222;padding:.5rem;border-radius:4px;font-size:.85rem}
  .note{color:#f0b060;font-size:.9rem}
  button{margin-right:.5rem;padding:.4rem .9rem;border-radius:6px;border:1px solid #444;background:#2a4d2a;color:#eee;cursor:pointer}
  button[value="queued"]{background:#2a3a4d} .danger{background:#4d2a2a}
</style></head><body>
<h1>Fila de revisão (${rows.length})</h1>
${cards || "<p>Nada pendente. 🎉</p>"}
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
      unauthorized(res);
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderPage());
      return;
    }

    const match = url.pathname.match(/^\/applications\/(\d+)$/);
    if (req.method === "POST" && match) {
      const id = Number(match[1]);
      const body = new URLSearchParams(await readBody(req));
      const action = body.get("action");
      if (action === "applied" || action === "queued" || action === "skipped") {
        db.update(applications)
          .set({
            status: action,
            updatedAt: sql`CURRENT_TIMESTAMP`,
            appliedAt: action === "applied" ? sql`CURRENT_TIMESTAMP` : null,
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

  server.listen(PORT, () => {
    console.log(`review UI em http://localhost:${PORT}${PASSWORD ? " (auth básica: icaro)" : ""}`);
  });
}

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  startReviewServer();
}
