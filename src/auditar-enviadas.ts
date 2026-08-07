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
    .trim();

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

const textosPortal: string[] = [];
try {
  await page.goto("https://portal.gupy.io/my/applications", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const abasVisiveis = page.locator('button:visible, [role=tab]:visible');
  const nAbas = Math.min(await abasVisiveis.count().catch(() => 0), 12);
  const rotulos: string[] = [];
  for (let a = 0; a < nAbas; a++) {
    const t = normalize(await abasVisiveis.nth(a).textContent().catch(() => null)).slice(0, 25);
    if (t) rotulos.push(t);
  }
  console.log(`[auditoria] abas/botões na página: ${rotulos.join(" · ")}`);

  for (const aba of ["Em andamento", "Finalizadas", "Encerradas", "Concluídas", "Todas"]) {
    const antes = textosPortal.length;
    const tab = page.locator(`button:visible:has-text("${aba}"), [role=tab]:visible:has-text("${aba}")`).first();
    if (!(await tab.isVisible().catch(() => false))) {
      console.log(`[auditoria] aba "${aba}" não existe`);
      continue;
    }
    {
      await tab.click().catch(() => {});
      await page.waitForTimeout(2500);
    }

    for (let pagina = 0; pagina < 15; pagina++) {
      const cards = page.locator("li, article").filter({ has: page.locator('a:has-text("Ver andamento")') });
      const total = await cards.count().catch(() => 0);

      for (let i = 0; i < total; i++) {
        const texto = normalize(await cards.nth(i).textContent().catch(() => null));
        if (!texto) continue;
        textosPortal.push(`${aba}|${texto}`);
      }

      const proxima = page
        .locator('button[aria-label*="róxima" i]:not([disabled]), [aria-label*="next" i]:not([disabled])')
        .first();
      if (!(await proxima.isVisible().catch(() => false))) break;
      await proxima.click().catch(() => {});
      await page.waitForTimeout(2500);
    }
    console.log(`[auditoria] aba "${aba}": ${textosPortal.length - antes} cartão(ões)`);
  }
} finally {
  await context.close();
  await closeBrowser().catch(() => {});
}

const portalNormalizado = textosPortal.map((t) => chave(t));
console.log(`[auditoria] portal mostra: ${textosPortal.length} cartão(ões)\n`);

const achaNoPortal = (titulo: string): boolean => {
  const alvo = chave(titulo);
  if (alvo.length < 8) return false;
  const curto = alvo.slice(0, 40);
  return portalNormalizado.some((t) => t.includes(curto));
};

const ausentes = noBanco.filter((r) => !achaNoPortal(r.titulo));

if (ausentes.length === 0) {
  console.log(`[auditoria] OK — todas as ${noBanco.length} marcadas como enviadas existem no portal`);
} else {
  console.log(`[auditoria] ATENÇÃO — ${ausentes.length} de ${noBanco.length} marcadas como enviadas NÃO encontradas no portal:`);
  for (const r of ausentes) console.log(`   ${r.empresa} — ${r.titulo.slice(0, 60)}`);
}
