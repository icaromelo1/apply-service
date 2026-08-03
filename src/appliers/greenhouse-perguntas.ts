import type { Locator, Page } from "playwright";
import { llmAvailable, responderQuestionario, type Pergunta } from "../llm.js";
import type { Job } from "../types.js";
import { combina, ehDadoSensivel, normalize } from "./gupy-flow.js";

const IGNORAR = /first name|last name|email|phone|resume|cover letter|linkedin|website|^attach|upload|curr[íi]culo|drag and drop|arraste/i;

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

function controle(wrapper: Locator): Locator {
  return wrapper.locator(".select__control, [class*='-control']").first();
}

function entrada(wrapper: Locator): Locator {
  return wrapper.locator(".select__input-container input, input[id^='react-select']").first();
}

function menuDe(wrapper: Locator): Locator {
  return wrapper.locator(".select__menu, [class*='-menu']").first();
}

async function opcoesVisiveis(page: Page, wrapper: Locator): Promise<Locator> {
  const proprio = menuDe(wrapper).locator("[role=option]");
  if ((await proprio.count()) > 0) return proprio;
  return page.locator("[role=option]");
}

async function abrirMenu(page: Page, wrapper: Locator): Promise<boolean> {
  const ctrl = controle(wrapper);
  if ((await ctrl.count()) === 0) return false;
  await ctrl.click({ timeout: 4000 });
  await page.waitForTimeout(500);
  return (await (await opcoesVisiveis(page, wrapper)).count()) > 0;
}

async function opcoesDoSelect(page: Page, wrapper: Locator): Promise<string[]> {
  const nativo = wrapper.locator("select");
  if ((await nativo.count()) > 0) {
    return (await nativo.locator("option").allTextContents()).map(normalize).filter((o) => o && !/^select/i.test(o));
  }

  try {
    if (!(await abrirMenu(page, wrapper))) return [];
    const opcoes = (await (await opcoesVisiveis(page, wrapper)).allTextContents()).map(normalize).filter(Boolean);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
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

    const dentroDeTelefone =
      (await wrapper
        .locator("xpath=ancestor-or-self::*[contains(@class,'phone-input') or contains(@class,'PhoneInput')]")
        .count()
        .catch(() => 0)) > 0;
    const temTel = (await wrapper.locator("input[type=tel]").count().catch(() => 0)) > 0;
    if (dentroDeTelefone || temTel) continue;

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

    const ultimo = campos[campos.length - 1];
    if (ultimo && ultimo.tipo === "select" && ultimo.opcoes.length === 0 && temTexto) {
      ultimo.tipo = "texto";
    }
  }
  return campos;
}

function melhorOpcao(valor: string, opcoes: string[]): string | null {
  if (opcoes.length === 0) return null;
  const exata = opcoes.find((o) => o.toLowerCase() === valor.toLowerCase());
  if (exata) return exata;

  const candidatas = opcoes.filter((o) => combina(valor, o));
  if (candidatas.length === 0) return null;

  return candidatas.reduce((menor, atual) => (atual.length < menor.length ? atual : menor));
}

async function preencherSelect(
  page: Page,
  wrapper: Locator,
  valor: string,
  opcoes: string[] = [],
): Promise<boolean> {
  const escolhido = melhorOpcao(valor, opcoes) ?? valor;

  const nativo = wrapper.locator("select");
  if ((await nativo.count()) > 0) {
    try {
      await nativo.selectOption({ label: escolhido });
      return true;
    } catch {
      return false;
    }
  }

  try {
    if (!(await abrirMenu(page, wrapper))) return false;

    const opcoes_ = await opcoesVisiveis(page, wrapper);
    const exata = opcoes_.filter({ hasText: new RegExp(`^\\s*${escapeRegex(escolhido)}\\s*$`, "i") }).first();
    if (await exata.isVisible().catch(() => false)) {
      await exata.click();
      await page.waitForTimeout(300);
      return await confirmado(wrapper, escolhido);
    }

    const campo = entrada(wrapper);
    if ((await campo.count()) > 0) {
      await campo.fill(escolhido).catch(() => {});
      await page.waitForTimeout(600);
      const primeira = (await opcoesVisiveis(page, wrapper)).first();
      if (await primeira.isVisible().catch(() => false)) {
        await primeira.click();
        await page.waitForTimeout(300);
        return await confirmado(wrapper, escolhido);
      }
    }

    await page.keyboard.press("Escape");
  } catch {}

  return await digitarEConfirmar(page, wrapper, escolhido);
}

async function digitarEConfirmar(page: Page, wrapper: Locator, valor: string): Promise<boolean> {
  const texto = wrapper.locator("input[type=text], input:not([type]), textarea").first();
  if ((await texto.count()) === 0) return false;

  try {
    await texto.fill(valor);
    await page.waitForTimeout(700);

    const sugestao = page.locator("[role=option], [role=listbox] li").first();
    if (await sugestao.isVisible().catch(() => false)) {
      await sugestao.click();
      await page.waitForTimeout(300);
      return true;
    }

    return normalize(await texto.inputValue().catch(() => "")).length > 0;
  } catch {
    return false;
  }
}

function escapeRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function confirmado(wrapper: Locator, valor: string): Promise<boolean> {
  const escolhido = normalize(
    await wrapper.locator(".select__single-value, [class*='-singleValue']").first().textContent().catch(() => null),
  );
  if (!escolhido) return false;
  return combina(valor, escolhido) || escolhido.toLowerCase() === valor.toLowerCase();
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

  const PADROES_DECLINAR = [
    "Decline To Self Identify",
    "I don't wish to answer",
    "I do not wish to answer",
    "Prefer not to say",
  ];

  const eeo = campos.filter((c) => EEO.test(c.rotulo));
  for (const campo of eeo) {
    const declinar = opcaoDeclinar(campo.opcoes);
    if (declinar) {
      const ok = await preencherSelect(page, campo.wrapper, declinar, campo.opcoes).catch(() => false);
      if (ok) continue;
    }
    for (const tentativa of PADROES_DECLINAR) {
      const ok = await preencherSelect(page, campo.wrapper, tentativa, campo.opcoes).catch(() => false);
      if (ok) break;
    }
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
    if (valor === null || /^(null|undefined)$/i.test(valor.trim())) {
      resultado.semResposta.push(campo.rotulo);
      continue;
    }

    const ok =
      campo.tipo === "select"
        ? await preencherSelect(page, campo.wrapper, valor, campo.opcoes)
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
