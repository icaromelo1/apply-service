import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "./config.js";
import type { Job } from "./types.js";

const MODEL = "claude-opus-5";
const BETAS = ["server-side-fallback-2026-07-01"];

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY não configurada — módulo LLM indisponível");
  }
  client ??= new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

function loadPerfil(): string {
  return readFileSync(config.paths.perfilPath, "utf-8");
}

function jobContext(job: Job): string {
  return [
    `Título: ${job.title}`,
    `Empresa: ${job.company}`,
    `Localização: ${job.location}`,
    job.description ? `Descrição:\n${job.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function extractText(response: Anthropic.Beta.BetaMessage): string {
  if (response.stop_reason === "refusal") {
    throw new Error(`LLM recusou a requisição (categoria: ${response.stop_details?.category ?? "desconhecida"})`);
  }
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("resposta do LLM sem bloco de texto");
  }
  return block.text;
}

export async function gerarCoverLetter(job: Job): Promise<string> {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 2048,
    betas: BETAS,
    fallbacks: "default",
    output_config: { effort: "medium" },
    system:
      "Você escreve cover letters curtas e específicas para candidaturas a vagas de tecnologia. Use exclusivamente os fatos do perfil do candidato fornecido — nunca invente experiências, números ou tecnologias. Escreva no idioma do anúncio da vaga. Máximo de 3 parágrafos, tom profissional e direto, sem clichês genéricos, conectando a experiência real do candidato aos requisitos da vaga. Responda apenas com o texto da cover letter, sem preâmbulo.",
    messages: [
      {
        role: "user",
        content: `Perfil do candidato:\n${loadPerfil()}\n\nVaga:\n${jobContext(job)}`,
      },
    ],
  });

  return extractText(response).trim();
}

export interface Pergunta {
  pergunta: string;
  opcoes?: string[];
}

export interface Resposta {
  pergunta: string;
  resposta: string | null;
}

const respostasSchema = z.object({
  respostas: z.array(
    z.object({
      pergunta: z.string(),
      resposta: z.string().nullable(),
    }),
  ),
});

const respostasJsonSchema = {
  type: "object",
  properties: {
    respostas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pergunta: { type: "string" },
          resposta: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["pergunta", "resposta"],
        additionalProperties: false,
      },
    },
  },
  required: ["respostas"],
  additionalProperties: false,
} as const;

export async function responderQuestionario(job: Job, perguntas: Pergunta[]): Promise<Resposta[]> {
  const perguntasTexto = perguntas
    .map((p, i) => `${i + 1}. ${p.pergunta}${p.opcoes?.length ? `\n   Opções: ${p.opcoes.join(" | ")}` : ""}`)
    .join("\n");

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 4096,
    betas: BETAS,
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: respostasJsonSchema },
    },
    system:
      "Você responde questionários de candidatura a vagas em nome de um candidato, usando EXCLUSIVAMENTE os fatos do perfil fornecido. Regra absoluta: se a resposta de uma pergunta não estiver clara e diretamente no perfil, retorne resposta null para ela — nunca chute, nunca infira além do escrito. Perguntas eliminatórias respondidas errado prejudicam o candidato; null é sempre melhor que um palpite. Quando houver opções, a resposta deve ser exatamente uma das opções fornecidas. Responda no idioma da pergunta.",
    messages: [
      {
        role: "user",
        content: `Perfil do candidato:\n${loadPerfil()}\n\nVaga:\n${jobContext(job)}\n\nPerguntas do questionário:\n${perguntasTexto}`,
      },
    ],
  });

  const parsed = respostasSchema.parse(JSON.parse(extractText(response)));
  return parsed.respostas;
}
