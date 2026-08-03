import { z } from "zod";
import { agyAvailable, agyPrompt, extrairJson } from "../llm-agy.js";
import { normalizeText } from "../lib/text.js";
import type { Job } from "../types.js";
import type { RequisitoVaga, RequisitosVaga } from "./types.js";

const MAX_REQUISITOS = 25;

const REQUISITOS_SYSTEM = `Você extrai requisitos técnicos de descrições de vagas de tecnologia. Identifique tecnologias, ferramentas, linguagens, frameworks e competências mencionadas. Marque "obrigatorio": true para o que aparece como requisito obrigatório/essencial/must-have, e "obrigatorio": false para desejável/diferencial/nice-to-have/plus. Para cada requisito, inclua siglas ou variantes de escrita conhecidas em "sinonimos". Extraia no máximo ${MAX_REQUISITOS} requisitos, do mais para o menos relevante. Responda APENAS com JSON válido, sem markdown e sem cercas de código, no formato: {"cargo":"título do cargo","requisitos":[{"termo":"Node.js","obrigatorio":true,"sinonimos":["node","nodejs"]}]}`;

const requisitoSchema = z.object({
  termo: z.string(),
  obrigatorio: z.boolean(),
  sinonimos: z.array(z.string()).default([]),
});

const requisitosVagaSchema = z.object({
  cargo: z.string(),
  requisitos: z.array(requisitoSchema),
});

function jobContext(job: Job): string {
  return [
    `Título: ${job.title}`,
    `Empresa: ${job.company}`,
    job.description ? `Descrição:\n${job.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function limitarRequisitos(dados: RequisitosVaga): RequisitosVaga {
  return {
    cargo: dados.cargo,
    requisitos: dados.requisitos.slice(0, MAX_REQUISITOS),
  };
}

const PALAVRAS_HEURISTICA = [
  "javascript",
  "typescript",
  "node.js",
  "nodejs",
  "react",
  "vue",
  "angular",
  "nuxt",
  "next.js",
  "nestjs",
  "express",
  "python",
  "django",
  "flask",
  "java",
  "spring",
  "kotlin",
  "php",
  "laravel",
  "ruby",
  "rails",
  "c#",
  ".net",
  "golang",
  "go",
  "rust",
  "sql",
  "postgresql",
  "postgres",
  "mysql",
  "mongodb",
  "redis",
  "elasticsearch",
  "docker",
  "kubernetes",
  "k8s",
  "aws",
  "azure",
  "gcp",
  "google cloud",
  "terraform",
  "ci/cd",
  "git",
  "graphql",
  "rest",
  "api rest",
  "microsservicos",
  "microservices",
  "kafka",
  "rabbitmq",
  "sqs",
  "html",
  "css",
  "sass",
  "tailwind",
  "webpack",
  "vite",
  "jest",
  "cypress",
  "playwright",
  "scrum",
  "agile",
  "linux",
  "bash",
  "shell",
  "ia",
  "inteligencia artificial",
  "machine learning",
  "data science",
];

const MARCADORES_OBRIGATORIO = [
  "obrigatorio",
  "obrigatorios",
  "requisito",
  "requisitos",
  "essencial",
  "must have",
  "must-have",
  "necessario",
];

const MARCADORES_DESEJAVEL = ["desejavel", "diferencial", "nice to have", "nice-to-have", "plus", "bonus"];

function extrairHeuristica(job: Job): RequisitosVaga {
  const descricao = job.description ?? "";
  const normalizado = normalizeText(descricao);
  const linhas = descricao.split("\n").map((linha) => normalizeText(linha));

  const requisitos: RequisitoVaga[] = [];

  for (const palavra of PALAVRAS_HEURISTICA) {
    const termoNormalizado = normalizeText(palavra);
    if (!normalizado.includes(termoNormalizado)) continue;

    const linhaComTermo = linhas.find((linha) => linha.includes(termoNormalizado));
    const contextoDesejavel = linhaComTermo
      ? MARCADORES_DESEJAVEL.some((m) => linhaComTermo.includes(normalizeText(m)))
      : false;
    const contextoObrigatorio = linhaComTermo
      ? MARCADORES_OBRIGATORIO.some((m) => linhaComTermo.includes(normalizeText(m)))
      : false;

    requisitos.push({
      termo: palavra,
      obrigatorio: contextoDesejavel ? false : contextoObrigatorio,
      sinonimos: [],
    });

    if (requisitos.length >= MAX_REQUISITOS) break;
  }

  return {
    cargo: job.title,
    requisitos,
  };
}

export async function extrairRequisitos(job: Job): Promise<RequisitosVaga> {
  if (!agyAvailable()) {
    return extrairHeuristica(job);
  }

  try {
    const saida = await agyPrompt(REQUISITOS_SYSTEM, jobContext(job));
    const dados = requisitosVagaSchema.parse(JSON.parse(extrairJson(saida)));
    return limitarRequisitos(dados);
  } catch (err) {
    console.error(`[cv] extração via LLM falhou, usando heurística: ${err instanceof Error ? err.message.slice(0, 120) : err}`);
    return extrairHeuristica(job);
  }
}

type DicionarioSinonimos = Record<string, string[]>;

const DICIONARIO_SINONIMOS: DicionarioSinonimos = {
  "ci/cd": ["integracao continua", "continuous integration", "continuous delivery", "continuous deployment"],
  "integracao continua": ["ci/cd", "continuous integration"],
  "continuous integration": ["ci/cd", "integracao continua"],
  aws: ["amazon web services"],
  "amazon web services": ["aws"],
  k8s: ["kubernetes"],
  kubernetes: ["k8s"],
  js: ["javascript"],
  javascript: ["js"],
  ts: ["typescript"],
  typescript: ["ts"],
  bd: ["banco de dados", "database"],
  "banco de dados": ["bd", "database"],
  database: ["bd", "banco de dados"],
  "api rest": ["restful", "rest api"],
  restful: ["api rest", "rest api"],
  "rest api": ["api rest", "restful"],
  ia: ["inteligencia artificial", "ai"],
  "inteligencia artificial": ["ia", "ai"],
  ai: ["ia", "inteligencia artificial"],
  sql: ["banco relacional"],
  "banco relacional": ["sql"],
};

function semPontuacao(s: string): string {
  return s.replace(/[.\-_/\\+#]/g, "").replace(/\s+/g, " ").trim();
}

export function normalizarTermo(termo: string): string[] {
  const normalizado = normalizeText(termo).trim();
  const sinonimos = DICIONARIO_SINONIMOS[normalizado] ?? DICIONARIO_SINONIMOS[semPontuacao(normalizado)] ?? [];
  const variantes = new Set([normalizado, semPontuacao(normalizado), ...sinonimos.flatMap((s) => [s, semPontuacao(s)])]);
  return [...variantes].filter(Boolean);
}
