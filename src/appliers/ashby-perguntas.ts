import type { Locator, Page } from "playwright";
import { llmAvailable, responderDissertativa, responderQuestionario, type Pergunta } from "../llm.js";
import type { Job } from "../types.js";
import { combina, ehDadoSensivel, normalize } from "./gupy-flow.js";

const IGNORAR = /^(name|full name|email|resume|cv|first name|last name)\b/i;
const EEO = /gender|race|ethnic|veteran|disability|pronoun|sexual orientation|age|transgender|diversity|community/i;
const DECLINAR = /prefer not to (answer|say|disclose)|decline to self.?identify|i (don.t|do not) (wish|want) to answer|none of the above|i am not a protected veteran/i;
const ESCOLHA_UNICA = /answer\s*1\s*of\s*\d|answer only one|responda apenas uma|do not answer more than one/i;

type Tipo = "texto" | "dissertativa" | "radio" | "checkbox";

interface Campo {
  rotulo: string;
  entrada: Locator;
  tipo: Tipo;
  opcoes: string[];
  obrigatorio: boolean;
}

async function rotuloDaOpcao(entrada: Locator, item: Locator): Promise<string> {
  const aninhado = normalize(await item.locator("xpath=ancestor::label[1]").textContent().catch(() => null));
  if (aninhado) return aninhado;

  const id = await item.getAttribute("id").catch(() => null);
  if (id) {
    const porFor = normalize(await entrada.locator(`label[for="${id}"]`).first().textContent().catch(() => null));
    if (porFor) return porFor;
  }

  const irmao = normalize(
    await item
      .locator("xpath=following-sibling::*[self::label or self::span or self::div][1]")
      .textContent()
      .catch(() => null),
  );
  if (irmao) return irmao;

  const pai = normalize(await item.locator("xpath=..").textContent().catch(() => null));
  return pai.length <= 120 ? pai : "";
}

async function opcoesDoGrupo(entrada: Locator, seletor: string): Promise<string[]> {
  const itens = entrada.locator(seletor);
  const total = Math.min(await itens.count().catch(() => 0), 15);
  const opcoes: string[] = [];

  for (let i = 0; i < total; i++) {
    const rotulo = await rotuloDaOpcao(entrada, itens.nth(i));
    if (rotulo) opcoes.push(rotulo);
  }
  return opcoes;
}

export async function coletarCamposAshby(page: Page): Promise<Campo[]> {
  const entradas = page.locator(".ashby-application-form-field-entry, [class*='_fieldEntry_']");
  const total = Math.min(await entradas.count().catch(() => 0), 40);
  const campos: Campo[] = [];

  for (let i = 0; i < total; i++) {
    const entrada = entradas.nth(i);
    const rotulo = normalize(await entrada.locator("label").first().textContent().catch(() => null))
      .replace(/\*$/, "")
      .trim();
    if (!rotulo || rotulo.length < 4 || IGNORAR.test(rotulo)) continue;
    if (campos.some((c) => c.rotulo === rotulo)) continue;

    const conta = async (sel: string): Promise<number> => entrada.locator(sel).count().catch(() => 0);

    const radios = await conta("input[type=radio]");
    const checks = await conta("input[type=checkbox]");
    const areas = await conta("textarea");
    const textos = await conta("input[type=text], input[type=tel], input[type=url]");

    let tipo: Tipo | null = null;
    if (radios > 0) tipo = "radio";
    else if (checks > 0) tipo = "checkbox";
    else if (areas > 0) tipo = "dissertativa";
    else if (textos > 0) tipo = "texto";
    if (!tipo) continue;

    const bruto = (await entrada.textContent().catch(() => "")) ?? "";

    campos.push({
      rotulo,
      entrada,
      tipo,
      opcoes: tipo === "radio" ? await opcoesDoGrupo(entrada, "input[type=radio]") : [],
      obrigatorio: bruto.includes("*") || (await conta("[aria-required=true]")) > 0,
    });
  }

  return campos;
}

async function marcarOpcao(entrada: Locator, valor: string, opcoes: string[]): Promise<boolean> {
  const exato = opcoes.findIndex((o) => o.toLowerCase() === valor.toLowerCase());
  const alvoIdx = exato >= 0 ? exato : opcoes.findIndex((o) => combina(valor, o));
  if (alvoIdx < 0) return false;

  const radio = entrada.locator("input[type=radio]").nth(alvoIdx);
  if ((await radio.count().catch(() => 0)) > 0) {
    await radio.check({ timeout: 4000, force: true }).catch(async () => {
      await radio.click({ timeout: 4000, force: true }).catch(() => {});
    });
    if (await radio.isChecked().catch(() => false)) return true;
  }

  const porTexto = entrada.locator("label").filter({ hasText: opcoes[alvoIdx]! }).first();
  if ((await porTexto.count().catch(() => 0)) > 0) {
    await porTexto.click({ timeout: 4000 }).catch(() => {});
    return await radio.isChecked().catch(() => false);
  }
  return false;
}

async function marcarCheckbox(entrada: Locator, valor: string): Promise<boolean> {
  const sim = /^(sim|yes|true|1)$/i.test(valor.trim());
  const botoes = entrada.locator("button, label").filter({ hasText: /^\s*(yes|no|sim|n[ãa]o)\s*$/i });

  if ((await botoes.count().catch(() => 0)) >= 2) {
    const alvo = botoes.filter({ hasText: sim ? /^\s*(yes|sim)\s*$/i : /^\s*(no|n[ãa]o)\s*$/i }).first();
    if ((await alvo.count().catch(() => 0)) > 0) {
      await alvo.click({ timeout: 4000 }).catch(() => {});
      return true;
    }
  }

  const caixa = entrada.locator("input[type=checkbox]").first();
  if ((await caixa.count().catch(() => 0)) === 0) return false;

  const marcada = await caixa.isChecked().catch(() => false);
  if (sim !== marcada) await caixa.click({ timeout: 4000 }).catch(() => {});
  return true;
}

export interface ResultadoAshby {
  respondidas: number;
  semResposta: string[];
  sensiveis: string[];
  naoPreenchidas: string[];
}

export async function responderPerguntasAshby(page: Page, job: Job): Promise<ResultadoAshby> {
  const vazio: ResultadoAshby = { respondidas: 0, semResposta: [], sensiveis: [], naoPreenchidas: [] };
  const campos = await coletarCamposAshby(page);
  if (campos.length === 0 || !llmAvailable()) return vazio;

  const resultado: ResultadoAshby = { respondidas: 0, semResposta: [], sensiveis: [], naoPreenchidas: [] };

  for (const campo of campos.filter((c) => EEO.test(c.rotulo))) {
    const declinar = campo.opcoes.find((o) => DECLINAR.test(o));
    if (declinar && (await marcarOpcao(campo.entrada, declinar, campo.opcoes))) resultado.respondidas++;
    else if (campo.obrigatorio) resultado.sensiveis.push(campo.rotulo);
  }

  const restantes = campos.filter((c) => !EEO.test(c.rotulo));
  const dissertativas = restantes.filter((c) => c.tipo === "dissertativa");
  const objetivas = restantes.filter((c) => c.tipo !== "dissertativa");

  if (objetivas.length > 0) {
    const perguntas: Pergunta[] = objetivas.map((c) => ({
      pergunta: c.rotulo,
      opcoes: c.opcoes.length > 0 ? c.opcoes : undefined,
    }));

    const respostas = await responderQuestionario(job, perguntas);

    for (const [i, resposta] of respostas.entries()) {
      const campo = objetivas[i];
      if (!campo) continue;

      if (ehDadoSensivel(campo.rotulo)) {
        resultado.sensiveis.push(campo.rotulo);
        continue;
      }

      const valor = resposta.resposta;
      if (valor === null || /^(null|undefined)$/i.test(valor.trim())) {
        if (campo.obrigatorio) resultado.semResposta.push(campo.rotulo);
        continue;
      }

      const ok =
        campo.tipo === "radio"
          ? await marcarOpcao(campo.entrada, valor, campo.opcoes)
          : campo.tipo === "checkbox"
            ? await marcarCheckbox(campo.entrada, valor)
            : await campo.entrada
                .locator("input[type=text], input[type=tel], input[type=url]")
                .first()
                .fill(valor)
                .then(() => true)
                .catch(() => false);

      if (ok) resultado.respondidas++;
      else if (campo.obrigatorio) resultado.naoPreenchidas.push(`${campo.rotulo} → "${valor.slice(0, 40)}"`);
    }
  }

  await responderDissertativas(page, job, dissertativas, resultado);
  return resultado;
}

async function responderDissertativas(
  page: Page,
  job: Job,
  campos: Campo[],
  resultado: ResultadoAshby,
): Promise<void> {
  if (campos.length === 0) return;

  const corpo = normalize(await page.locator("form, main, body").first().textContent().catch(() => null));
  const escolhaUnica = ESCOLHA_UNICA.test(corpo);

  const alvos = escolhaUnica
    ? [...campos.filter((c) => c.obrigatorio), campos[0]!].slice(0, 1)
    : campos;

  for (const campo of alvos) {
    const texto = await responderDissertativa(job, campo.rotulo);
    if (!texto) {
      if (campo.obrigatorio) resultado.semResposta.push(campo.rotulo);
      continue;
    }

    const ok = await campo.entrada
      .locator("textarea")
      .first()
      .fill(texto)
      .then(() => true)
      .catch(() => false);

    if (ok) resultado.respondidas++;
    else if (campo.obrigatorio) resultado.naoPreenchidas.push(campo.rotulo);
  }
}
