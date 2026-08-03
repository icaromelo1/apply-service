import { existsSync } from "node:fs";
import type { Page } from "playwright";
import { config } from "../config.js";
import { gerarCvParaVaga } from "../cv/index.js";
import { gerarCoverLetter } from "../llm.js";
import type { Job } from "../types.js";
import { getBrowser, hasCaptcha, saveScreenshot, type ApplyOutcome } from "./browser.js";
import { aceitarTermos, responderPerguntasGreenhouse } from "./greenhouse-perguntas.js";
import { buscarCodigoVerificacao, leituraDeEmailDisponivel } from "../lib/codigo-email.js";

const BOARD_TOKEN: Record<string, string> = { onepeloton: "peloton" };

function boardToken(company: string): string {
  const limpo = company.toLowerCase().trim();
  return BOARD_TOKEN[limpo] ?? limpo.replace(/[^a-z0-9]/g, "");
}

export type SituacaoVaga =
  | { tipo: "greenhouse"; url: string }
  | { tipo: "expirada" }
  | { tipo: "site-proprio"; url: string }
  | { tipo: "indeterminada" };

export async function situacaoVaga(job: Job): Promise<SituacaoVaga> {
  const jid = job.url.match(/[?&]gh_jid=(\d+)/i)?.[1] ?? job.url.match(/greenhouse\.io\/[^/]+\/jobs\/(\d+)/i)?.[1];
  const token = boardToken(job.company);
  if (!jid || !token) return { tipo: "indeterminada" };

  try {
    const resp = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${jid}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (resp.status === 404) return { tipo: "expirada" };
    if (!resp.ok) return { tipo: "indeterminada" };

    const dados = (await resp.json()) as { absolute_url?: string };
    const alvo = dados.absolute_url;
    if (!alvo) return { tipo: "indeterminada" };

    if (/(job-boards|boards)\.greenhouse\.io/i.test(alvo)) return { tipo: "greenhouse", url: alvo };
    return { tipo: "site-proprio", url: alvo };
  } catch {
    return { tipo: "indeterminada" };
  }
}

async function confirmacaoVisivel(page: Page): Promise<boolean> {
  return (
    (await page
      .locator('text=/thank you|application.*(submitted|received)|obrigado/i')
      .count()
      .catch(() => 0)) > 0
  );
}

async function resolverCodigo(page: Page, submit: import("playwright").Locator): Promise<boolean> {
  if (!leituraDeEmailDisponivel()) return false;

  const desde = new Date(Date.now() - 10 * 60 * 1000);
  let codigo: string | null = null;

  for (let tentativa = 0; tentativa < 6 && !codigo; tentativa++) {
    await page.waitForTimeout(10000);
    codigo = await buscarCodigoVerificacao(desde).catch(() => null);
  }
  if (!codigo) return false;

  const caixas = page.locator('input[maxlength="1"], .security-code input, input[autocomplete="one-time-code"]');
  const total = await caixas.count().catch(() => 0);

  if (total >= codigo.length) {
    for (let i = 0; i < codigo.length; i++) {
      await caixas.nth(i).fill(codigo[i] ?? "").catch(() => {});
    }
  } else {
    const unico = page.locator('input[autocomplete="one-time-code"], input[name*="code" i]').first();
    if ((await unico.count()) === 0) return false;
    await unico.fill(codigo).catch(() => {});
  }

  await page.waitForTimeout(1500);
  if (await submit.isEnabled().catch(() => false)) {
    await submit.click().catch(() => {});
    return true;
  }
  return false;
}

async function fillFirst(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const field = page.locator(selector).first();
    if ((await field.count()) > 0 && (await field.isVisible().catch(() => false))) {
      await field.fill(value);
      return true;
    }
  }
  return false;
}

export async function applyGreenhouse(applicationId: number, job: Job): Promise<ApplyOutcome> {
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
    const situacao = await situacaoVaga(job);
    if (situacao.tipo === "expirada") {
      await context.close();
      return { status: "skipped", note: "vaga encerrada — removida do board do Greenhouse" };
    }
    if (situacao.tipo === "site-proprio") {
      await context.close();
      return {
        status: "needs_review",
        virarDigest: true,
        note: `site de carreira próprio (sem form Greenhouse) — aplicar em ${situacao.url}`,
      };
    }

    await page.goto(situacao.tipo === "greenhouse" ? situacao.url : job.url, { waitUntil: "domcontentloaded" });

    const applyButton = page
      .locator('a:has-text("Apply"), button:has-text("Apply"), a:has-text("Candidatar")')
      .first();
    if ((await applyButton.count()) > 0) {
      await applyButton.click().catch(() => {});
      await page.waitForLoadState("domcontentloaded");
    }

    if (await hasCaptcha(page)) {
      const shot = await saveScreenshot(page, applicationId);
      return { status: "needs_review", note: `captcha detectado — ${shot}` };
    }

    const filledFirst = await fillFirst(page, ['#first_name', 'input[name="first_name"]', 'input[autocomplete="given-name"]'], candidato.nome);
    const filledLast = await fillFirst(page, ['#last_name', 'input[name="last_name"]', 'input[autocomplete="family-name"]'], candidato.sobrenome);
    const filledEmail = await fillFirst(page, ['#email', 'input[name="email"]', 'input[type="email"]'], candidato.email);
    await fillFirst(page, ['#phone', 'input[name="phone"]', 'input[type="tel"]'], candidato.telefone);
    if (candidato.linkedin) {
      await fillFirst(
        page,
        ['input[aria-label*="LinkedIn" i]', 'input[id*="linkedin" i]', 'input[name*="linkedin" i]'],
        candidato.linkedin,
      );
    }

    if (!filledFirst || !filledLast || !filledEmail) {
      const shot = await saveScreenshot(page, applicationId);
      return { status: "needs_review", note: `form fora do padrão greenhouse — ${shot}` };
    }

    const resumeInput = page.locator('input[type="file"]').first();
    if ((await resumeInput.count()) === 0) {
      const shot = await saveScreenshot(page, applicationId);
      return { status: "needs_review", note: `campo de currículo não encontrado — ${shot}` };
    }
    const cv = await gerarCvParaVaga(job);
    await resumeInput.setInputFiles(cv.caminho);

    const coverField = page
      .locator('#cover_letter_text, textarea[name="cover_letter_text"], textarea[name*="cover"]')
      .first();
    if ((await coverField.count()) > 0) {
      await coverField.fill(await gerarCoverLetter(job));
    }

    const perguntas = await responderPerguntasGreenhouse(page, job);

    if (perguntas.sensiveis.length > 0) {
      return {
        status: "skipped",
        note: `DESCARTADA — exige dado sensível: ${perguntas.sensiveis.join(" | ")}`,
      };
    }

    if (perguntas.semResposta.length > 0) {
      const shot = await saveScreenshot(page, applicationId);
      return {
        status: "needs_review",
        note: `DADO FALTANDO NO PERFIL (${perguntas.semResposta.length}): ${perguntas.semResposta
          .map((p) => `"${p.slice(0, 70)}"`)
          .join(" | ")} — ${shot}`,
      };
    }

    if (perguntas.naoPreenchidas.length > 0) {
      const shot = await saveScreenshot(page, applicationId);
      return {
        status: "needs_review",
        note: `${perguntas.naoPreenchidas.length} campo(s) não preenchido(s): ${perguntas.naoPreenchidas.join(" | ").slice(0, 300)} — ${shot}`,
      };
    }

    const termosMarcados = await aceitarTermos(page).catch(() => 0);
    if (termosMarcados > 0) console.log(`[greenhouse] ${termosMarcados} termo(s) aceito(s)`);

    const submit = page
      .locator('button[type="submit"]:has-text("Submit"), #submit_app, button:has-text("Submit application")')
      .first();
    if ((await submit.count()) === 0) {
      const shot = await saveScreenshot(page, applicationId);
      return { status: "needs_review", note: `botão de submit não encontrado — ${shot}` };
    }

    await submit.click();

    const verificacao = page.locator('text=/verification code|c[óo]digo de verifica[çc][ãa]o/i').first();
    let exigeCodigo = false;
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(2000);
      if (await verificacao.isVisible().catch(() => false)) {
        exigeCodigo = true;
        break;
      }
      if ((await confirmacaoVisivel(page)) || (await submit.count().catch(() => 0)) === 0) break;
    }

    if (exigeCodigo) {
      const resolvido = await resolverCodigo(page, submit);
      if (!resolvido) {
        const shot = await saveScreenshot(page, applicationId);
        const motivo = leituraDeEmailDisponivel()
          ? "código de verificação não chegou a tempo no e-mail"
          : "vaga exige código de verificação por e-mail — configure EMAIL_USER/EMAIL_PASSWORD";
        return { status: "needs_review", note: `${motivo} — ${shot}` };
      }
    }

    const confirmation = page.locator('text=/thank you|application.*(submitted|received)|obrigado/i');
    const erros = page.locator('.error, [class*="error"]:visible, [role="alert"]');

    const LIMITE_MS = 60000;
    const inicio = Date.now();
    let confirmado = false;
    let mensagemErro = "";

    while (Date.now() - inicio < LIMITE_MS) {
      if ((await confirmation.count().catch(() => 0)) > 0) {
        confirmado = true;
        break;
      }

      const textoErro = (await erros.allTextContents().catch(() => []))
        .map((t) => t.trim())
        .filter((t) => t.length > 3 && t.length < 200);
      if (textoErro.length > 0) {
        mensagemErro = [...new Set(textoErro)].join(" | ").slice(0, 220);
        break;
      }

      const enviando = await submit.isDisabled().catch(() => false);
      const aindaNoForm = (await submit.count().catch(() => 0)) > 0;
      if (!enviando && !aindaNoForm) break;

      await page.waitForTimeout(2000);
    }

    if (confirmado) {
      const prova = await saveScreenshot(page, applicationId);
      return {
        status: "applied",
        note: `confirmada — evidência: ${prova}`,
        aderencia: cv.score?.cobertura,
        cvPath: cv.sobMedida ? cv.caminho : undefined,
      };
    }

    const shot = await saveScreenshot(page, applicationId);
    if (mensagemErro) {
      return { status: "needs_review", note: `form recusou o envio: ${mensagemErro} — ${shot}` };
    }
    return { status: "needs_review", note: `submit sem confirmação clara — verificar — ${shot}` };
  } catch (err) {
    const shot = await saveScreenshot(page, applicationId).catch(() => "sem screenshot");
    return { status: "failed", note: `${err instanceof Error ? err.message : String(err)} — ${shot}` };
  } finally {
    await context.close();
  }
}
