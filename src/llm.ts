import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, Type } from "@google/genai";
import { agyAvailable, agyPrompt, extrairJson } from "./llm-agy.js";
import { z } from "zod";
import { config } from "./config.js";
import type { Job } from "./types.js";

const ANTHROPIC_MODEL = "claude-opus-5";
const ANTHROPIC_BETAS = ["server-side-fallback-2026-07-01"];

const COVER_LETTER_SYSTEM =
  "Você escreve cover letters curtas e específicas para candidaturas a vagas de tecnologia. Use exclusivamente os fatos do perfil do candidato fornecido — nunca invente experiências, números ou tecnologias. Escreva no idioma do anúncio da vaga. Máximo de 3 parágrafos, tom profissional e direto, sem clichês genéricos, conectando a experiência real do candidato aos requisitos da vaga. Responda apenas com o texto da cover letter, sem preâmbulo.";

const QUESTIONARIO_SYSTEM = `Você responde questionários de candidatura a vagas em nome de um candidato, usando os fatos do perfil fornecido.

REGRA FACTUAL (perguntas sobre fatos verificáveis — anos de experiência, tecnologias dominadas, salário, formação, certificações, disponibilidade, dados pessoais): responda EXCLUSIVAMENTE com o que está no perfil. Se o fato não estiver lá, retorne null. Nunca invente experiência que o candidato não tem, nunca infle anos, nunca chute valores. Perguntas eliminatórias respondidas erradas prejudicam o candidato; null é sempre melhor que um palpite.

REGRA SUBJETIVA (perguntas de fit cultural, motivação, valores, estilo de trabalho, "por que essa vaga", "como você lida com X", "o que te motiva"): componha uma resposta verdadeira a partir das seções de perfil comportamental, experiências e desafios, conectando-as ao contexto REAL da vaga (empresa, produto, stack e valores citados na descrição). Destaque o que genuinamente se alinha e escreva na primeira pessoa, de forma concreta e específica — cite fatos e experiências reais do perfil em vez de adjetivos genéricos. Máximo de 4 a 6 linhas. Nunca afirme afinidade com valor, causa ou tecnologia que não tenha respaldo no perfil; se a pergunta subjetiva não tiver nenhum respaldo factual no perfil, retorne null.

FAIXAS SALARIAIS: quando as opções forem faixas de valores, escolha a menor faixa cujo teto seja maior ou igual à pretensão mínima do candidato. Se todas as faixas estiverem acima da pretensão dele, escolha a menor faixa oferecida (receber mais não é problema). Nunca retorne null só porque a pretensão exata não aparece entre as opções.

FORMATO: quando houver opções, a resposta deve ser exatamente uma das opções fornecidas; se for múltipla escolha (caixas de seleção) e mais de uma se aplicar, separe as opções com ' | '. Perguntas explicitamente opcionais que não se aplicam (matrícula de indicação, campo só para colaboradores) podem ser respondidas com string vazia. Responda sempre no idioma da pergunta.`;

let anthropicClient: Anthropic | null = null;
let geminiClient: GoogleGenAI | null = null;

export function llmAvailable(): boolean {
  return agyAvailable() || Boolean(config.geminiApiKey || config.anthropicApiKey);
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

function perguntasTexto(perguntas: Pergunta[]): string {
  return perguntas
    .map((p, i) => `${i + 1}. ${p.pergunta}${p.opcoes?.length ? `\n   Opções: ${p.opcoes.join(" | ")}` : ""}`)
    .join("\n");
}

function getGemini(): GoogleGenAI {
  geminiClient ??= new GoogleGenAI({ apiKey: config.geminiApiKey });
  return geminiClient;
}

function getAnthropic(): Anthropic {
  anthropicClient ??= new Anthropic({ apiKey: config.anthropicApiKey });
  return anthropicClient;
}

function extractAnthropicText(response: Anthropic.Beta.BetaMessage): string {
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
  const userContent = `Perfil do candidato:\n${loadPerfil()}\n\nVaga:\n${jobContext(job)}`;

  if (agyAvailable()) {
    return (await agyPrompt(COVER_LETTER_SYSTEM, userContent)).trim();
  }

  if (config.geminiApiKey) {
    const response = await getGemini().models.generateContent({
      model: config.geminiModel,
      contents: userContent,
      config: { systemInstruction: COVER_LETTER_SYSTEM },
    });
    const text = response.text;
    if (!text) throw new Error("Gemini retornou resposta vazia");
    return text.trim();
  }

  if (config.anthropicApiKey) {
    const response = await getAnthropic().beta.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      betas: ANTHROPIC_BETAS,
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: COVER_LETTER_SYSTEM,
      messages: [{ role: "user", content: userContent }],
    });
    return extractAnthropicText(response).trim();
  }

  throw new Error("nenhuma chave de LLM configurada (GEMINI_API_KEY ou ANTHROPIC_API_KEY)");
}

export async function responderQuestionario(job: Job, perguntas: Pergunta[]): Promise<Resposta[]> {
  const userContent = `Perfil do candidato:\n${loadPerfil()}\n\nVaga:\n${jobContext(job)}\n\nPerguntas do questionário:\n${perguntasTexto(perguntas)}`;

  if (agyAvailable()) {
    const formato = `\n\nResponda APENAS com JSON válido, sem markdown e sem cercas de código, no formato: {"respostas":[{"pergunta":"texto exato da pergunta","resposta":"sua resposta ou null"}]}`;
    const saida = await agyPrompt(QUESTIONARIO_SYSTEM + formato, userContent);
    return respostasSchema.parse(JSON.parse(extrairJson(saida))).respostas;
  }

  if (config.geminiApiKey) {
    const response = await getGemini().models.generateContent({
      model: config.geminiModel,
      contents: userContent,
      config: {
        systemInstruction: QUESTIONARIO_SYSTEM,
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: Type.OBJECT,
          properties: {
            respostas: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  pergunta: { type: Type.STRING },
                  resposta: { type: Type.STRING, nullable: true },
                },
                required: ["pergunta", "resposta"],
              },
            },
          },
          required: ["respostas"],
        },
      },
    });
    const text = response.text;
    if (!text) throw new Error("Gemini retornou resposta vazia");
    return respostasSchema.parse(JSON.parse(text)).respostas;
  }

  if (config.anthropicApiKey) {
    const response = await getAnthropic().beta.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      betas: ANTHROPIC_BETAS,
      fallbacks: "default",
      output_config: {
        effort: "medium",
        format: {
          type: "json_schema",
          schema: {
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
          },
        },
      },
      system: QUESTIONARIO_SYSTEM,
      messages: [{ role: "user", content: userContent }],
    });
    return respostasSchema.parse(JSON.parse(extractAnthropicText(response))).respostas;
  }

  throw new Error("nenhuma chave de LLM configurada (GEMINI_API_KEY ou ANTHROPIC_API_KEY)");
}
