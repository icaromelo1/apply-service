import { existsSync } from "node:fs";
import { config } from "../config.js";
import { gerarCvParaVaga } from "../cv/index.js";
import type { Job } from "../types.js";
import { getBrowser, hasCaptcha, saveScreenshot, type ApplyOutcome } from "./browser.js";
import { aceitarTermos } from "./greenhouse-perguntas.js";
import { responderPerguntasAshby } from "./ashby-perguntas.js";

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

    const perguntas = await responderPerguntasAshby(page, job);
    if (perguntas.sensiveis.length > 0) {
      return { status: "skipped", note: `DESCARTADA — exige dado sensível: ${perguntas.sensiveis.join(" | ")}` };
    }
    if (perguntas.naoPreenchidas.length > 0) {
      const shot = await saveScreenshot(page, applicationId);
      return {
        status: "needs_review",
        note: `campo(s) obrigatório(s) não preenchido(s): ${perguntas.naoPreenchidas.join(" | ").slice(0, 200)} — ${shot}`,
      };
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

    const confirmacao = page.locator(
      "text=/thank you|application (submitted|received)|we.ve received|obrigado/i",
    );
    const erros = page.locator('[role="alert"], [class*="error"]:visible, [aria-invalid="true"]');

    let confirmado = false;
    let mensagemErro = "";
    const inicio = Date.now();

    while (Date.now() - inicio < 60000) {
      if ((await confirmacao.count().catch(() => 0)) > 0) {
        confirmado = true;
        break;
      }

      const textos = (await erros.allTextContents().catch(() => []))
        .map((t) => t.trim())
        .filter((t) => t.length > 3 && t.length < 200);
      if (textos.length > 0) {
        mensagemErro = [...new Set(textos)].join(" | ").slice(0, 220);
        break;
      }

      if ((await enviar.count().catch(() => 0)) === 0) {
        for (let i = 0; i < 6 && !confirmado; i++) {
          await page.waitForTimeout(2000);
          if ((await confirmacao.count().catch(() => 0)) > 0) confirmado = true;
        }
        break;
      }

      await page.waitForTimeout(2000);
    }

    if (!confirmado) {
      await page.waitForTimeout(3000);
      confirmado = (await confirmacao.count().catch(() => 0)) > 0;
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
    return { status: "needs_review", note: `envio sem confirmação clara — verificar — ${shot}` };
  } catch (err) {
    const shot = await saveScreenshot(page, applicationId).catch(() => "sem screenshot");
    return { status: "failed", note: `${err instanceof Error ? err.message : String(err)} — ${shot}` };
  } finally {
    await context.close();
  }
}
