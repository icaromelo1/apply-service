import { existsSync } from "node:fs";
import { like, sql } from "drizzle-orm";
import type { Page } from "playwright";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { applications, jobs } from "../db/schema.js";
import type { Job } from "../types.js";
import { getBrowser, saveScreenshot } from "./browser.js";
import { avancarIntro, dismissarModais, normalize, responderEEnviar } from "./gupy-flow.js";

const ETAPA_HUMANA = /test|avalia|entrevista|interview|video|v[íi]deo|bate-papo|case|desafio|oferta/i;

export interface EtapasResult {
  avancadas: number;
  aguardandoHumano: number;
  semPendencia: number;
  falhas: number;
}

function anotarPorTitulo(titulo: string, nota: string): void {
  const rows = db
    .select({ id: applications.id, title: jobs.title })
    .from(applications)
    .innerJoin(jobs, sql`${jobs.id} = ${applications.jobId}`)
    .where(like(applications.method, "gupy"))
    .all();

  const alvo = rows.find((r) => normalize(r.title).toLowerCase() === normalize(titulo).toLowerCase());
  if (!alvo) return;

  db.update(applications)
    .set({ reviewNote: nota, updatedAt: sql`CURRENT_TIMESTAMP` })
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

export async function resolverEtapasGupy(): Promise<EtapasResult> {
  const result: EtapasResult = { avancadas: 0, aguardandoHumano: 0, semPendencia: 0, falhas: 0 };
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
    console.log(`[etapas] ${links.length} candidatura(s) em andamento`);

    for (const link of links) {
      try {
        await page.goto(link, { waitUntil: "networkidle" });
        await page.waitForTimeout(3000);

        const titulo = await tituloDaVaga(page);

        const acao = page
          .locator('button:has-text("Começar"), button:has-text("Responder"), a:has-text("Começar")')
          .first();
        if (!(await acao.isVisible().catch(() => false))) {
          result.semPendencia++;
          continue;
        }

        await acao.click({ timeout: 5000 });
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(2000);

        const url = page.url();
        const slug = url.includes("/steps/") ? (url.split("/steps/")[1]?.split("/")[1] ?? "") : "";

        if (ETAPA_HUMANA.test(slug) || ETAPA_HUMANA.test(normalize(await page.textContent("h1, h2").catch(() => "")))) {
          const shot = await saveScreenshot(page, 0);
          anotarPorTitulo(titulo, `etapa exige você (${slug || "teste/entrevista"}) — ${shot}`);
          result.aguardandoHumano++;
          continue;
        }

        await dismissarModais(page);
        await avancarIntro(page);

        const job: Job = {
          id: `etapa-${slug}`,
          title: titulo,
          company: "",
          location: "",
          url: link,
          source: "Gupy",
          sources: ["Gupy"],
          keyword: "",
          keywords: [],
        };

        const outcome = await responderEEnviar(page, 0, job);
        console.log(`[etapas] ${titulo} → ${outcome.status}${outcome.note ? ` (${outcome.note})` : ""}`);
        anotarPorTitulo(titulo, `etapa ${slug || "questionário"}: ${outcome.status} — ${outcome.note ?? ""}`);

        if (outcome.status === "applied") result.avancadas++;
        else if (outcome.status === "failed") result.falhas++;
        else result.aguardandoHumano++;
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
