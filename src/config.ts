import { readFileSync } from "node:fs";
import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const envSchema = z.object({
  SCRAPER_URL: z.preprocess(emptyToUndefined, z.string().url().default("http://127.0.0.1:8081")),
  GUPY_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().default("https://employability-portal.gupy.io")),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  GEMINI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  GEMINI_MODEL: z.preprocess(emptyToUndefined, z.string().default("gemini-2.5-flash")),
  DISCORD_WEBHOOK_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
});

const env = envSchema.parse(process.env);

const criteriosSchema = z.object({
  keywords: z.array(z.string()),
  searchKeywords: z.array(z.string()).optional(),
  remoteOnly: z.boolean(),
  senioridade: z.array(z.string()),
  locais: z.array(z.string()),
  tetoDiario: z.number(),
  cooldownEmpresaDias: z.number(),
  minScore: z.number(),
});

export type Criterios = z.infer<typeof criteriosSchema>;

const candidatoSchema = z.object({
  nome: z.string(),
  sobrenome: z.string(),
  email: z.string(),
  telefone: z.string(),
  linkedin: z.string(),
  github: z.string(),
});

export type Candidato = z.infer<typeof candidatoSchema>;

const paths = {
  root: process.cwd(),
  dataDir: "data",
  profileDir: "profile",
  criteriosPath: "profile/criterios.json",
  perfilPath: "profile/perfil.md",
  curriculoPath: "profile/curriculo.pdf",
  candidatoPath: "profile/candidato.json",
  gupySessionPath: "profile/sessions/gupy.json",
  screenshotsDir: "data/screenshots",
};

function loadCriterios(): Criterios {
  const raw = readFileSync(paths.criteriosPath, "utf-8");
  return criteriosSchema.parse(JSON.parse(raw));
}

function loadCandidato(): Candidato | null {
  try {
    const raw = readFileSync(paths.candidatoPath, "utf-8");
    const candidato = candidatoSchema.parse(JSON.parse(raw));
    if (Object.values(candidato).some((v) => v.includes("<preencher>"))) return null;
    return candidato;
  } catch {
    return null;
  }
}

export const config = {
  scraperUrl: env.SCRAPER_URL,
  gupyBaseUrl: env.GUPY_BASE_URL,
  anthropicApiKey: env.ANTHROPIC_API_KEY,
  geminiApiKey: env.GEMINI_API_KEY,
  geminiModel: env.GEMINI_MODEL,
  discordWebhookUrl: env.DISCORD_WEBHOOK_URL,
  paths,
  criterios: loadCriterios(),
  candidato: loadCandidato(),
};
