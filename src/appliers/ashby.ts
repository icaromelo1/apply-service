import { existsSync } from "node:fs";
import { config } from "../config.js";
import { gerarCvParaVaga } from "../cv/index.js";
import type { Job } from "../types.js";
import { getBrowser, hasCaptcha, saveScreenshot, type ApplyOutcome } from "./browser.js";
import { aceitarTermos, responderPerguntasGreenhouse } from "./greenhouse-perguntas.js";

async function preencher(page: import("playwright").Page, seletores: string[], valor: string): Promise<boolean> {
  for (const seletor of seletores) {
    const campo = page.locator(seletor).first();
    if ((await campo.count()) > 0 && (await campo.isVisible().catch(() => false))) {
      await campo.fill(valor);
      return true;
    }
  }
  return false;
}

export async function applyAshby(applicationId: number, job: Job): Promise<ApplyOutcome> {
  const candidato = config.candidato;
  if (!candidato) return { status: "needs_review", note: "profile/candidato.json não preenchido" };
  if (!existsSync(config.paths.curriculoPath)) return { status: "needs_review", note: "currículo ausente" };

  const context = await (await getBrowser()).newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    await page.goto(job.url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

    const botaoAplicar = page
      .locator('a:has-text("Apply"), button:has-text("Apply"), a:has-text("Application")')
      .first();
    if (await botaoAplicar.isVisible().catch(() => false)) {
      await botaoAplicar.click().catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    }

    if (await hasCaptcha(page)) {
      const shot = await saveScreenshot(page, applicationId);
      return { status: "needs_review", note: `captcha detectado — ${shot}` };
    }

    const nome = await preencher(
      page,
      ['input[name="_systemfield_name"]', 'input[id*="name" i]:not([id*="last" i])', 'input[placeholder*="name" i]'],
      `${candidato.nome} ${candidato.sobrenome}`,
    );
    const email = await preencher(
      page,
      ['input[name="_systemfield_email"]', 'input[type="email"]'],
      candidato.email,
    );
    await preencher(page, ['input[name*="phone" i]', 'input[type="tel"]'], candidato.telefone);

    if (!nome || !email) {
      const shot = await saveScreenshot(page, applicationId);
      return { status: "needs_review", note: `form fora do padrão ashby — ${shot}` };
    }

    const upload = page.locator('input[type="file"]').first();
    if ((await upload.count()) === 0) {
      const shot = await saveScreenshot(page, applicationId);
      return { status: "needs_review", note: `campo de currículo não encontrado — ${shot}` };
    }
    const cv = await gerarCvParaVaga(job);
    await upload.setInputFiles(cv.caminho);
    await page.waitForTimeout(2500);

    const perguntas = await responderPerguntasGreenhouse(page, job);
    if (perguntas.sensiveis.length > 0) {
      return { status: "skipped", note: `DESCARTADA — exige dado sensível: ${perguntas.sensiveis.join(" | ")}` };
    }
    if (perguntas.semResposta.length > 0) {
      const shot = await saveScreenshot(page, applicationId);
      return {
        status: "needs_review",
        note: `DADO FALTANDO NO PERFIL (${perguntas.semResposta.length}): ${perguntas.semResposta.join(" | ").slice(0, 250)} — ${shot}`,
      };
    }

    await aceitarTermos(page).catch(() => 0);

    const enviar = page.locator('button[type="submit"], button:has-text("Submit")').first();
    if ((await enviar.count()) === 0) {
      const shot = await saveScreenshot(page, applicationId);
      return { status: "needs_review", note: `botão de envio não encontrado — ${shot}` };
    }

    await enviar.click();
    await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});

    const confirmacao = page.locator("text=/thank you|application (submitted|received)|we.ve received/i");
    if ((await confirmacao.count()) > 0) {
      const prova = await saveScreenshot(page, applicationId);
      return { status: "applied", note: `confirmada — evidência: ${prova}`, aderencia: cv.score?.cobertura, cvPath: cv.sobMedida ? cv.caminho : undefined };
    }

    const shot = await saveScreenshot(page, applicationId);
    return { status: "needs_review", note: `envio sem confirmação clara — verificar — ${shot}` };
  } catch (err) {
    const shot = await saveScreenshot(page, applicationId).catch(() => "sem screenshot");
    return { status: "failed", note: `${err instanceof Error ? err.message : String(err)} — ${shot}` };
  } finally {
    await context.close();
  }
}
