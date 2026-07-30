import { existsSync } from "node:fs";
import { config } from "../config.js";
import type { Job } from "../types.js";
import { getBrowser, saveScreenshot, type ApplyOutcome } from "./browser.js";
import { avancarIntro, dismissarModais, responderEEnviar } from "./gupy-flow.js";

export async function applyGupy(applicationId: number, job: Job): Promise<ApplyOutcome> {
  if (!existsSync(config.paths.gupySessionPath)) {
    return { status: "needs_review", note: "sessão Gupy ausente — rodar npm run gupy:login no Mac" };
  }

  const context = await (await getBrowser()).newContext({ storageState: config.paths.gupySessionPath });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    await page.goto(job.url, { waitUntil: "domcontentloaded" });

    const applyButton = page
      .locator('a:has-text("Candidatar"), button:has-text("Candidatar"), a:has-text("Quero me candidatar"), button:has-text("Quero me candidatar")')
      .first();
    try {
      await applyButton.waitFor({ state: "visible", timeout: 15000 });
    } catch {
      const shot = await saveScreenshot(page, applicationId);
      return { status: "needs_review", note: `botão de candidatura não encontrado (vaga encerrada?) — ${shot}` };
    }
    await applyButton.click();
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

    if (/login|signin|auth/i.test(page.url())) {
      return { status: "needs_review", note: "sessão Gupy expirada — rodar npm run gupy:login de novo" };
    }

    const flowContent = page.locator("form, main:has(button), [data-testid*=apply]").first();
    try {
      await flowContent.waitFor({ state: "visible", timeout: 20000 });
    } catch {
      const shot = await saveScreenshot(page, applicationId);
      return { status: "needs_review", note: `fluxo de candidatura não carregou — ${shot}` };
    }

    await dismissarModais(page);
    await avancarIntro(page);

    return await responderEEnviar(page, applicationId, job);
  } catch (err) {
    const shot = await saveScreenshot(page, applicationId).catch(() => "sem screenshot");
    return { status: "failed", note: `${err instanceof Error ? err.message : String(err)} — ${shot}` };
  } finally {
    await context.close();
  }
}
