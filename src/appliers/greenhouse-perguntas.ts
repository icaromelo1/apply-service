import type { Locator, Page } from "playwright";
import { llmAvailable, responderQuestionario, type Pergunta } from "../llm.js";
import type { Job } from "../types.js";
import { ehDadoSensivel, normalize } from "./gupy-flow.js";

const IGNORAR = /first name|last name|email|phone|resume|cover letter|linkedin profile|website|^attach|upload|curr[íi]culo|drag and drop|arraste/i;

const EEO = /gender|transgender|sexual orientation|race|ethnicit|hispanic|latino|veteran|disability|pronoun|identidade de g[êe]nero|orienta[çc][ãa]o sexual|ra[çc]a|etnia|defici[êe]ncia/i;

function opcaoDeclinar(opcoes: string[]): string | null {
  const padroes = [
    /decline to self.?identify/i, /prefer not to (say|answer|disclose)/i, /i (don.t|do not) wish to answer/i,
    /prefiro n[ãa]o (informar|responder|declarar)/i, /n[ãa]o desejo (informar|responder)/i,
  ];
  for (const p of padroes) {
    const achado = opcoes.find((o) => p.test(o));
    if (achado) return achado;
  }
  return null;
}

interface Campo {
  rotulo: string;
  wrapper: Locator;
  tipo: "texto" | "select";
  opcoes: string[];
}

async function opcoesDoSelect(page: Page, wrapper: Locator): Promise<string[]> {
  const nativo = wrapper.locator("select");
  if ((await nativo.count()) > 0) {
    return (await nativo.locator("option").allTextContents()).map(normalize).filter((o) => o && !/^select/i.test(o));
  }

  const shell = wrapper.locator(".select-shell, [class*='-container']").first();
  if ((await shell.count()) === 0) return [];

  try {
    await shell.click({ timeout: 4000 });
    await page.waitForTimeout(400);
    const opcoes = (await page.locator("[role=option]").allTextContents()).map(normalize).filter(Boolean);
    await page.keyboard.press("Escape");
    return opcoes;
  } catch {
    return [];
  }
}

export async function coletarCampos(page: Page): Promise<Campo[]> {
  const campos: Campo[] = [];
  const wrappers = page.locator(".field-wrapper, div:has(> label.label)");
  const total = Math.min(await wrappers.count(), 40);

  for (let i = 0; i < total; i++) {
    const wrapper = wrappers.nth(i);
    const rotulo = normalize(await wrapper.locator("label").first().textContent().catch(() => null)).replace(/\*$/, "").trim();
    if (!rotulo || rotulo.length < 4 || IGNORAR.test(rotulo)) continue;
    if (campos.some((c) => c.rotulo === rotulo)) continue;

    const temSelect =
      (await wrapper.locator("select, .select-shell, [class*='-container']").count().catch(() => 0)) > 0;
    const temTexto = (await wrapper.locator("input[type=text], textarea").count().catch(() => 0)) > 0;
    if (!temSelect && !temTexto) continue;

    campos.push({
      rotulo,
      wrapper,
      tipo: temSelect ? "select" : "texto",
      opcoes: temSelect ? await opcoesDoSelect(page, wrapper) : [],
    });
  }
  return campos;
}

async function preencherSelect(page: Page, wrapper: Locator, valor: string): Promise<boolean> {
  const nativo = wrapper.locator("select");
  if ((await nativo.count()) > 0) {
    try {
      await nativo.selectOption({ label: valor });
      return true;
    } catch {
      return false;
    }
  }

  const shell = wrapper.locator(".select-shell, [class*='-container']").first();
  try {
    await shell.click({ timeout: 4000 });
    await page.waitForTimeout(400);
    const opcao = page.locator("[role=option]").filter({ hasText: valor }).first();
    if (await opcao.isVisible().catch(() => false)) {
      await opcao.click();
      return true;
    }
    await page.keyboard.press("Escape");
  } catch {}
  return false;
}

export interface ResultadoPerguntas {
  respondidas: number;
  semResposta: string[];
  sensiveis: string[];
  naoPreenchidas: string[];
}

export async function responderPerguntasGreenhouse(page: Page, job: Job): Promise<ResultadoPerguntas> {
  const vazio: ResultadoPerguntas = { respondidas: 0, semResposta: [], sensiveis: [], naoPreenchidas: [] };
  const campos = await coletarCampos(page);
  if (campos.length === 0 || !llmAvailable()) return vazio;

  const eeo = campos.filter((c) => EEO.test(c.rotulo));
  for (const campo of eeo) {
    const declinar = opcaoDeclinar(campo.opcoes);
    if (declinar) await preencherSelect(page, campo.wrapper, declinar).catch(() => false);
  }

  const restantes = campos.filter((c) => !EEO.test(c.rotulo));
  if (restantes.length === 0) return { respondidas: eeo.length, semResposta: [], sensiveis: [], naoPreenchidas: [] };

  const perguntas: Pergunta[] = restantes.map((c) => ({
    pergunta: c.rotulo,
    opcoes: c.opcoes.length > 0 ? c.opcoes : undefined,
  }));

  const respostas = await responderQuestionario(job, perguntas);
  const resultado: ResultadoPerguntas = { respondidas: 0, semResposta: [], sensiveis: [], naoPreenchidas: [] };

  for (const [i, resposta] of respostas.entries()) {
    const campo = restantes[i];
    if (!campo) continue;

    if (ehDadoSensivel(campo.rotulo)) {
      resultado.sensiveis.push(campo.rotulo);
      continue;
    }

    const valor = resposta.resposta;
    if (valor === null || /^(null|undefined|n\/a)$/i.test(valor.trim())) {
      resultado.semResposta.push(campo.rotulo);
      continue;
    }

    const ok =
      campo.tipo === "select"
        ? await preencherSelect(page, campo.wrapper, valor)
        : await campo.wrapper
            .locator("input[type=text], textarea")
            .first()
            .fill(valor)
            .then(() => true)
            .catch(() => false);

    if (ok) resultado.respondidas++;
    else resultado.naoPreenchidas.push(`${campo.rotulo} → "${valor.slice(0, 40)}"`);
  }

  return resultado;
}
