import type { Idioma } from "./types.js";
import type { Job } from "../types.js";

const MARCADORES_EN = [
  "requirements", "responsibilities", "we are looking", "you will", "experience with",
  "qualifications", "about the role", "what you", "nice to have", "benefits", "your role",
];
const MARCADORES_PT = [
  "requisitos", "responsabilidades", "estamos em busca", "você vai", "experiência com",
  "qualificações", "sobre a vaga", "o que você", "diferencial", "benefícios", "atividades",
];

function contar(texto: string, marcadores: string[]): number {
  return marcadores.reduce((n, m) => n + (texto.includes(m) ? 1 : 0), 0);
}

const BRASIL =
  /\bbrasil\b|\bbrazil\b|\bbr\b|s[ãa]o paulo|rio de janeiro|belo horizonte|porto alegre|curitiba|florian[óo]polis|recife|fortaleza|salvador|bras[íi]lia|campinas|goi[âa]nia|manaus|bel[ée]m|natal|jo[ãa]o pessoa|vit[óo]ria|macei[óo]|teresina|s[ãa]o jos[ée] dos campos|santa catarina|minas gerais|paran[áa]|bahia|pernambuco|cear[áa]|rio grande do sul/i;

const FONTES_INTERNACIONAIS = /greenhouse|lever|ashby|workable/i;

function ehDoBrasil(job: Job): boolean | null {
  const local = job.location ?? "";
  if (!local.trim()) return null;
  if (BRASIL.test(local)) return true;

  const remotoGenerico = /^\s*(remoto|remote|home ?office|an+ywhere)\s*$/i.test(local.trim());
  return remotoGenerico ? null : false;
}

export function detectarIdioma(job: Job): Idioma {
  const brasileira = ehDoBrasil(job);
  if (brasileira === false) return "en";

  const texto = `${job.title} ${job.description ?? ""}`.toLowerCase();
  const en = contar(texto, MARCADORES_EN);
  const pt = contar(texto, MARCADORES_PT);

  if (brasileira === true) {
    return en > pt && pt === 0 ? "en" : "pt";
  }

  if (FONTES_INTERNACIONAIS.test(job.source) && pt === 0) return "en";

  if (en > pt) return "en";
  if (pt > en) return "pt";
  return /[áàâãéêíóôõúç]/.test(texto) ? "pt" : "en";
}
