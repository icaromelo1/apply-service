import { sql } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { applications, jobs } from "./db/schema.js";
import { getBrowser, closeBrowser } from "./appliers/browser.js";
import { normalize } from "./appliers/gupy-flow.js";

const chave = (t: string): string =>
  normalize(t)
    .toLowerCase()
    .replace(/[^\wà-ú\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

const noBanco = db
  .select({ titulo: jobs.title, empresa: jobs.company, status: applications.status, metodo: applications.method })
  .from(applications)
  .innerJoin(jobs, sql`${jobs.id} = ${applications.jobId}`)
  .where(sql`${applications.method} = 'gupy' and ${applications.status} = 'applied'`)
  .all();

console.log(`[auditoria] banco diz: ${noBanco.length} candidatura(s) enviada(s) pela Gupy`);

const context = await (await getBrowser()).newContext({ storageState: config.paths.gupySessionPath });
const page = await context.newPage();
page.setDefaultTimeout(25000);

const noPortal = new Map<string, string>();

try {
  await page.goto("https://portal.gupy.io/my/applications", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  for (const aba of ["Em andamento", "Finalizadas"]) {
    const tab = page.locator(`button:has-text("${aba}"), [role=tab]:has-text("${aba}")`).first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click().catch(() => {});
      await page.waitForTimeout(2500);
    }

    for (let pagina = 0; pagina < 15; pagina++) {
      const cards = page.locator("li, article").filter({ has: page.locator('a:has-text("Ver andamento")') });
      const total = await cards.count().catch(() => 0);

      for (let i = 0; i < total; i++) {
        const texto = normalize(await cards.nth(i).textContent().catch(() => null));
        if (!texto) continue;
        const titulo = texto.split(/\s{2,}|·|\|/)[0] ?? texto;
        noPortal.set(chave(titulo), `${aba}: ${texto.slice(0, 90)}`);
      }

      const proxima = page
        .locator('button[aria-label*="róxima" i]:not([disabled]), [aria-label*="next" i]:not([disabled])')
        .first();
      if (!(await proxima.isVisible().catch(() => false))) break;
      await proxima.click().catch(() => {});
      await page.waitForTimeout(2500);
    }
  }
} finally {
  await context.close();
  await closeBrowser().catch(() => {});
}

console.log(`[auditoria] portal mostra: ${noPortal.size} candidatura(s)\n`);

const ausentes = noBanco.filter((r) => !noPortal.has(chave(r.titulo)));

if (ausentes.length === 0) {
  console.log("[auditoria] OK — toda candidatura marcada como enviada existe no portal da Gupy");
} else {
  console.log(`[auditoria] ATENÇÃO — ${ausentes.length} marcada(s) como enviada(s) mas NÃO encontrada(s) no portal:`);
  for (const r of ausentes) console.log(`   ${r.empresa} — ${r.titulo.slice(0, 60)}`);
}

const titulosBanco = new Set(noBanco.map((r) => chave(r.titulo)));
const soNoPortal = [...noPortal.entries()].filter(([k]) => !titulosBanco.has(k));
if (soNoPortal.length > 0) {
  console.log(`\n[auditoria] ${soNoPortal.length} no portal que o banco não conta como enviada:`);
  for (const [, v] of soNoPortal.slice(0, 15)) console.log(`   ${v}`);
}
