import { existsSync } from "node:fs";
import type { Locator, Page } from "playwright";
import { config } from "../config.js";
import { llmAvailable, responderQuestionario, type Pergunta, type Resposta } from "../llm.js";
import type { Job } from "../types.js";
import { getBrowser, saveScreenshot, type ApplyOutcome } from "./browser.js";

const AUTO_SUBMIT = process.env.GUPY_AUTO_SUBMIT === "true";

function normalize(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

async function extractPerguntas(page: Page): Promise<{ pergunta: Pergunta; locator: Locator }[]> {
  const result: { pergunta: Pergunta; locator: Locator }[] = [];
  const headings = page.locator("h3").filter({ hasText: /^\s*\d+\s*\./ });
  const count = await headings.count();

  for (let i = 0; i < count; i++) {
    const heading = headings.nth(i);
    const wrapper = heading.locator("xpath=ancestor::div[2]");
    const label = normalize(await heading.textContent().catch(() => null))
      .replace(/^\d+\s*\.\s*/, "")
      .replace(/\s*\*\s*$/, "");
    if (!label) continue;

    const opcoes = (await wrapper.locator("label .MuiFormControlLabel-label").allTextContents())
      .map(normalize)
      .filter(Boolean);

    result.push({ pergunta: { pergunta: label, opcoes: opcoes.length > 0 ? opcoes : undefined }, locator: wrapper });
  }
  return result;
}

async function fillAnswer(group: Locator, resposta: string): Promise<boolean> {
  const parts = resposta
    .split(/\s*\|\s*/)
    .map(normalize)
    .filter(Boolean);

  let marked = false;
  const labels = group.locator("label:has(input[type=radio]), label:has(input[type=checkbox])");
  const labelCount = await labels.count();
  for (let i = 0; i < labelCount; i++) {
    const text = normalize(await labels.nth(i).textContent().catch(() => null));
    if (parts.includes(text)) {
      await labels.nth(i).click().catch(() => {});
      marked = true;
    }
  }
  if (marked) return true;

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

    const dismissModal = page
      .locator('button:has-text("Me lembrar depois"), a:has-text("Me lembrar depois")')
      .first();
    if (await dismissModal.isVisible().catch(() => false)) {
      await dismissModal.click();
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    }

    for (let step = 0; step < 3; step++) {
      const continuar = page
        .locator('button:has-text("Continuar"), button:has-text("Avançar"), button:has-text("Próximo")')
        .first();
      if (!(await continuar.isVisible().catch(() => false))) break;
      try {
        await continuar.click({ timeout: 5000 });
      } catch {
        break;
      }
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    }

    const responderAgora = page.locator('button:has-text("Responder agora")').first();
    if (await responderAgora.isVisible().catch(() => false)) {
      if (!llmAvailable()) {
        const shot = await saveScreenshot(page, applicationId);
        return {
          status: "needs_review",
          note: `vaga tem questionário da empresa e nenhuma chave de LLM está configurada (GEMINI_API_KEY ou ANTHROPIC_API_KEY) — responder manualmente — ${shot}`,
        };
      }
      try {
        await responderAgora.click({ timeout: 5000 });
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      } catch {}
    }

    await page
      .locator("h3")
      .filter({ hasText: /^\s*\d+\s*\./ })
      .first()
      .waitFor({ state: "visible", timeout: 20000 })
      .catch(() => {});

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

    const confirmation = page.locator(
      "text=/candidatura (enviada|realizada|concluída|recebida|efetuada|finalizada)|atualização para a sua candidatura|boa sorte/i",
    );
    const submitTexts = ["Salvar e continuar", "Enviar candidatura", "Finalizar candidatura", "Concluir candidatura", "Enviar"];

    let clickedAny = false;
    for (let step = 0; step < 4; step++) {
      if ((await confirmation.count()) > 0) break;

      let clicked = false;
      for (const text of submitTexts) {
        const btn = page.locator(`button:has-text("${text}")`).first();
        if (await btn.isVisible().catch(() => false)) {
          try {
            await btn.click({ timeout: 5000 });
            clicked = true;
            clickedAny = true;
            break;
          } catch {}
        }
      }
      if (!clicked) break;
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    }

    if ((await confirmation.count()) > 0) {
      const proof = await saveScreenshot(page, applicationId);
      return { status: "applied", note: `confirmada — evidência: ${proof}`, answers: answersJson };
    }

    const shot = await saveScreenshot(page, applicationId);
    if (!clickedAny) {
      return { status: "needs_review", note: `botão de envio não encontrado — ${shot}`, answers: answersJson };
    }
    return { status: "needs_review", note: `envio sem confirmação clara — verificar em Minhas Candidaturas — ${shot}`, answers: answersJson };
  } catch (err) {
    const shot = await saveScreenshot(page, applicationId).catch(() => "sem screenshot");
    return { status: "failed", note: `${err instanceof Error ? err.message : String(err)} — ${shot}` };
  } finally {
    await context.close();
  }
}
