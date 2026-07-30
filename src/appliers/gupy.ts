import { existsSync } from "node:fs";
import type { Locator, Page } from "playwright";
import { config } from "../config.js";
import { responderQuestionario, type Pergunta, type Resposta } from "../llm.js";
import type { Job } from "../types.js";
import { getBrowser, saveScreenshot, type ApplyOutcome } from "./browser.js";

const AUTO_SUBMIT = process.env.GUPY_AUTO_SUBMIT === "true";

async function extractPerguntas(page: Page): Promise<{ pergunta: Pergunta; locator: Locator }[]> {
  const result: { pergunta: Pergunta; locator: Locator }[] = [];
  const groups = page.locator("form fieldset, form [role=group], form [data-testid*=question]");
  const count = await groups.count();

  for (let i = 0; i < count; i++) {
    const group = groups.nth(i);
    const label = (await group.locator("legend, label, p").first().textContent().catch(() => null))?.trim();
    if (!label) continue;

    const opcoes = (
      await group.locator("label:has(input[type=radio]), label:has(input[type=checkbox]), option").allTextContents()
    )
      .map((o) => o.trim())
      .filter((o) => o && !/selecione/i.test(o));

    result.push({ pergunta: { pergunta: label, opcoes: opcoes.length > 0 ? opcoes : undefined }, locator: group });
  }
  return result;
}

async function fillAnswer(group: Locator, resposta: string): Promise<boolean> {
  const radio = group.locator(`label:has-text("${resposta}") input[type=radio]`).first();
  if ((await radio.count()) > 0) {
    await radio.check();
    return true;
  }
  const select = group.locator("select").first();
  if ((await select.count()) > 0) {
    await select.selectOption({ label: resposta }).catch(() => select.selectOption(resposta));
    return true;
  }
  const textInput = group.locator("textarea, input[type=text], input[type=number]").first();
  if ((await textInput.count()) > 0) {
    await textInput.fill(resposta);
    return true;
  }
  return false;
}

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
    await page.waitForLoadState("domcontentloaded");

    if (/login|signin|auth/i.test(page.url())) {
      return { status: "needs_review", note: "sessão Gupy expirada — rodar npm run gupy:login de novo" };
    }

    const extracted = await extractPerguntas(page);
    let respostas: Resposta[] = [];
    if (extracted.length > 0) {
      respostas = await responderQuestionario(
        job,
        extracted.map((e) => e.pergunta),
      );
    }

    const answersJson = JSON.stringify(respostas, null, 2);
    const semResposta = respostas.filter((r) => r.resposta === null);

    for (const [i, resposta] of respostas.entries()) {
      const target = extracted[i];
      if (!target || resposta.resposta === null) continue;
      await fillAnswer(target.locator, resposta.resposta).catch(() => {});
    }

    if (semResposta.length > 0) {
      const shot = await saveScreenshot(page, applicationId);
      return {
        status: "needs_review",
        note: `${semResposta.length} pergunta(s) sem resposta no perfil — completar e enviar manualmente — ${shot}`,
        answers: answersJson,
      };
    }

    if (!AUTO_SUBMIT) {
      const shot = await saveScreenshot(page, applicationId);
      return {
        status: "needs_review",
        note: `preenchido; envio manual (GUPY_AUTO_SUBMIT desligado) — ${shot}`,
        answers: answersJson,
      };
    }

    const submit = page
      .locator('button[type=submit]:has-text("Enviar"), button:has-text("Finalizar candidatura"), button:has-text("Enviar candidatura")')
      .first();
    if ((await submit.count()) === 0) {
      const shot = await saveScreenshot(page, applicationId);
      return { status: "needs_review", note: `botão de envio não encontrado — ${shot}`, answers: answersJson };
    }

    await submit.click();
    await page.waitForLoadState("networkidle").catch(() => {});

    if ((await page.locator("text=/candidatura (enviada|realizada|concluída)/i").count()) > 0) {
      return { status: "applied", answers: answersJson };
    }

    const shot = await saveScreenshot(page, applicationId);
    return { status: "needs_review", note: `envio sem confirmação clara — verificar — ${shot}`, answers: answersJson };
  } catch (err) {
    const shot = await saveScreenshot(page, applicationId).catch(() => "sem screenshot");
    return { status: "failed", note: `${err instanceof Error ? err.message : String(err)} — ${shot}` };
  } finally {
    await context.close();
  }
}
