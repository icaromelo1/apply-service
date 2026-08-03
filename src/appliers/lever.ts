import { existsSync } from "node:fs";
import { config } from "../config.js";
import { gerarCvParaVaga } from "../cv/index.js";
import { gerarCoverLetter } from "../llm.js";
import type { Job } from "../types.js";
import { getBrowser, hasCaptcha, saveScreenshot, type ApplyOutcome } from "./browser.js";

export async function applyLever(applicationId: number, job: Job): Promise<ApplyOutcome> {
  const candidato = config.candidato;
  if (!candidato) {
    return { status: "needs_review", note: "profile/candidato.json não preenchido" };
  }
  if (!existsSync(config.paths.curriculoPath)) {
    return { status: "needs_review", note: "profile/curriculo.pdf ausente" };
  }

  const context = await (await getBrowser()).newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  try {
    const applyUrl = job.url.includes("/apply") ? job.url : `${job.url.replace(/\/$/, "")}/apply`;
    await page.goto(applyUrl, { waitUntil: "domcontentloaded" });

    if (await hasCaptcha(page)) {
      const shot = await saveScreenshot(page, applicationId);
      return { status: "needs_review", note: `captcha detectado — ${shot}` };
    }

    const nameField = page.locator('input[name="name"]').first();
    if ((await nameField.count()) === 0) {
      const shot = await saveScreenshot(page, applicationId);
      return { status: "needs_review", note: `form fora do padrão lever — ${shot}` };
    }

    await nameField.fill(`${candidato.nome} ${candidato.sobrenome}`);
    await page.locator('input[name="email"]').first().fill(candidato.email);

    const phone = page.locator('input[name="phone"]').first();
    if ((await phone.count()) > 0) await phone.fill(candidato.telefone);

    const urls = page.locator('input[name="urls[LinkedIn]"]').first();
    if ((await urls.count()) > 0) await urls.fill(candidato.linkedin);

    const github = page.locator('input[name="urls[GitHub]"]').first();
    if ((await github.count()) > 0) await github.fill(candidato.github);

    const resume = page.locator('input[name="resume"], input[type="file"]').first();
    if ((await resume.count()) === 0) {
      const shot = await saveScreenshot(page, applicationId);
      return { status: "needs_review", note: `campo de currículo não encontrado — ${shot}` };
    }
    const cv = await gerarCvParaVaga(job);
    await resume.setInputFiles(cv.caminho);

    const comments = page.locator('textarea[name="comments"]').first();
    if ((await comments.count()) > 0) {
      await comments.fill(await gerarCoverLetter(job));
    }

    const customCards = page.locator('input[name^="cards["], textarea[name^="cards["], select[name^="cards["]');
    if ((await customCards.count()) > 0) {
      const shot = await saveScreenshot(page, applicationId);
      return {
        status: "needs_review",
        note: `perguntas customizadas no form (${await customCards.count()}) — revisar e enviar manualmente — ${shot}`,
      };
    }

    const submit = page.locator('button[type="submit"], #btn-submit').first();
    if ((await submit.count()) === 0) {
      const shot = await saveScreenshot(page, applicationId);
      return { status: "needs_review", note: `botão de submit não encontrado — ${shot}` };
    }

    await submit.click();
    await page.waitForLoadState("networkidle").catch(() => {});

    if (page.url().includes("/thanks") || (await page.locator('text=/thank|application.*submitted/i').count()) > 0) {
      return { status: "applied", aderencia: cv.score?.cobertura, cvPath: cv.sobMedida ? cv.caminho : undefined };
    }

    const shot = await saveScreenshot(page, applicationId);
    return { status: "needs_review", note: `submit sem confirmação clara — verificar — ${shot}` };
  } catch (err) {
    const shot = await saveScreenshot(page, applicationId).catch(() => "sem screenshot");
    return { status: "failed", note: `${err instanceof Error ? err.message : String(err)} — ${shot}` };
  } finally {
    await context.close();
  }
}
