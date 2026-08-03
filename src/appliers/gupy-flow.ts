import type { Locator, Page } from "playwright";
import { llmAvailable, responderQuestionario, type Pergunta, type Resposta } from "../llm.js";
import type { Job } from "../types.js";
import { saveScreenshot, type ApplyOutcome } from "./browser.js";

export const AUTO_SUBMIT = process.env.GUPY_AUTO_SUBMIT === "true";

export function normalize(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export async function extractPerguntas(page: Page): Promise<{ pergunta: Pergunta; locator: Locator }[]> {
  const result: { pergunta: Pergunta; locator: Locator }[] = [];
  const vistos = new Set<string>();

  const enunciados = page
    .locator("h3, h4, legend, .form-group__label label, .form-group label, fieldset label, form label")
    .filter({ hasText: /^\s*\d+\s*[.)]/ });

  const count = await enunciados.count();
  for (let i = 0; i < count; i++) {
    const enunciado = enunciados.nth(i);
    const label = normalize(await enunciado.textContent().catch(() => null))
      .replace(/^\d+\s*[.)]\s*/, "")
      .replace(/\s*\*\s*$/, "");
    if (!label || vistos.has(label)) continue;
    vistos.add(label);

    const proximo = enunciado.locator("xpath=ancestor::*[.//input or .//textarea or .//select][1]");
    const wrapper = (await proximo.count().catch(() => 0)) > 0 ? proximo : enunciado.locator("xpath=..");

    const opcoes = await extrairOpcoes(wrapper);
    result.push({ pergunta: { pergunta: label, opcoes: opcoes.length > 0 ? opcoes : undefined }, locator: wrapper });
  }
  return result;
}

async function extrairOpcoes(wrapper: Locator): Promise<string[]> {
  const seletores = [
    "label .MuiFormControlLabel-label",
    "label.radio-button, label.checkbox-button",
    "label:has(input[type=radio])",
    "label:has(input[type=checkbox])",
    "option",
  ];
  const vistos = new Set<string>();
  for (const seletor of seletores) {
    for (const texto of await wrapper.locator(seletor).allTextContents().catch(() => [])) {
      const limpo = normalize(texto);
      if (limpo && limpo.length < 600 && !/^selecione/i.test(limpo)) vistos.add(limpo);
    }
    if (vistos.size > 0) break;
  }
  return [...vistos];
}

function prefixo(s: string): string {
  return s.split(/\s*[-–—:(]/)[0]!.trim().toLowerCase();
}

function combina(alvo: string, candidato: string): boolean {
  const a = alvo.toLowerCase();
  const c = candidato.toLowerCase();
  if (a === c) return true;
  if (a.length > 3 && c.includes(a)) return true;
  if (c.length > 3 && a.includes(c)) return true;

  const pa = prefixo(alvo);
  const pc = prefixo(candidato);
  if (pa.length > 3 && pc.length > 3 && (pa === pc || pa.includes(pc) || pc.includes(pa))) return true;

  return false;
}

export async function fillAnswer(group: Locator, resposta: string): Promise<boolean> {
  const parts = resposta
    .split(/\s*\|\s*/)
    .map(normalize)
    .filter(Boolean);

  let marked = false;
  const labels = group.locator("label:has(input[type=radio]), label:has(input[type=checkbox])");
  const labelCount = await labels.count();
  for (let i = 0; i < labelCount; i++) {
    const text = normalize(await labels.nth(i).textContent().catch(() => null));
    if (!text) continue;
    if (parts.some((p) => combina(p, text))) {
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

export async function dismissarModais(page: Page): Promise<void> {
  const dismiss = page.locator('button:has-text("Me lembrar depois"), a:has-text("Me lembrar depois")').first();
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click().catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  }
}

export async function avancarIntro(page: Page): Promise<void> {
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
}

export async function responderEEnviar(page: Page, applicationId: number, job: Job): Promise<ApplyOutcome> {
  const responderAgora = page.locator('button:has-text("Responder agora")').first();
  if (await responderAgora.isVisible().catch(() => false)) {
    if (!llmAvailable()) {
      const shot = await saveScreenshot(page, applicationId);
      return {
        status: "needs_review",
        note: `questionário presente e nenhuma chave de LLM configurada — responder manualmente — ${shot}`,
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

  if (extracted.length > 0) {
    const campos = page.locator("form textarea, form input, textarea, input[type=text]");
    const total = await campos.count();
    let desabilitados = 0;
    for (let i = 0; i < total; i++) {
      if (await campos.nth(i).isDisabled().catch(() => false)) desabilitados++;
    }
    if (total > 0 && desabilitados === total) {
      return { status: "applied", note: "etapa já respondida anteriormente (campos travados pela Gupy)" };
    }
  }

  let respostas: Resposta[] = [];
  if (extracted.length > 0) {
    respostas = await responderQuestionario(
      job,
      extracted.map((e) => e.pergunta),
    );
  }

  const answersJson = JSON.stringify(respostas, null, 2);
  const ehVazia = (r: string | null): boolean => r === null || /^(null|undefined|n\/a)$/i.test(r.trim());
  const semResposta = respostas.filter((r) => ehVazia(r.resposta));

  const naoPreenchidas: string[] = [];
  for (const [i, resposta] of respostas.entries()) {
    const target = extracted[i];
    const valor = resposta.resposta;
    if (!target || valor === null || ehVazia(valor)) continue;
    const ok = await fillAnswer(target.locator, valor).catch(() => false);
    if (!ok) {
      naoPreenchidas.push(
        `"${resposta.pergunta.slice(0, 60)}" (resposta gerada: "${valor.slice(0, 60)}"; opções: ${
          target.pergunta.opcoes?.slice(0, 4).join(" / ").slice(0, 120) ?? "nenhuma detectada"
        })`,
      );
    }
  }

  if (naoPreenchidas.length > 0) {
    const shot = await saveScreenshot(page, applicationId);
    return {
      status: "needs_review",
      note: `${naoPreenchidas.length} campo(s) não preenchido(s) — ${naoPreenchidas.join(" | ").slice(0, 500)} — ${shot}`,
      answers: answersJson,
    };
  }

  if (semResposta.length > 0) {
    const shot = await saveScreenshot(page, applicationId);
    const faltando = semResposta.map((r) => `"${r.pergunta.slice(0, 90)}"`).join(" | ");
    return {
      status: "needs_review",
      note: `DADO FALTANDO NO PERFIL (${semResposta.length}): ${faltando} — ${shot}`,
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
    "text=/candidatura (enviada|realizada|concluída|recebida|efetuada|finalizada)|atualização para a sua candidatura|respostas enviadas|etapa concluída|boa sorte/i",
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

  const obrigatorios = await page.locator("text=/campo obrigat[óo]rio/i").count();
  if (obrigatorios > 0) {
    return {
      status: "needs_review",
      note: `envio recusado: ${obrigatorios} campo(s) obrigatório(s) não preenchido(s) — o form usa opções que não casaram — ${shot}`,
      answers: answersJson,
    };
  }

  return { status: "needs_review", note: `envio sem confirmação clara — verificar em Minhas Candidaturas — ${shot}`, answers: answersJson };
}
