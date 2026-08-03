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

export function detectarIdioma(job: Job): Idioma {
  const texto = `${job.title} ${job.description ?? ""}`.toLowerCase();
  const en = contar(texto, MARCADORES_EN);
  const pt = contar(texto, MARCADORES_PT);
  if (en > pt) return "en";
  if (pt > en) return "pt";
  return /[áàâãéêíóôõúç]/.test(texto) ? "pt" : "en";
}
