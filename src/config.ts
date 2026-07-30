import { readFileSync } from "node:fs";
import { z } from "zod";

const envSchema = z.object({
  SCRAPER_URL: z.string().url().default("http://127.0.0.1:8081"),
  GUPY_BASE_URL: z.string().url().default("https://employability-portal.gupy.io"),
  ANTHROPIC_API_KEY: z.string().optional(),
  DISCORD_WEBHOOK_URL: z.string().url().optional(),
});

const env = envSchema.parse(process.env);

const criteriosSchema = z.object({
  keywords: z.array(z.string()),
  remoteOnly: z.boolean(),
  senioridade: z.array(z.string()),
  locais: z.array(z.string()),
  tetoDiario: z.number(),
  cooldownEmpresaDias: z.number(),
  minScore: z.number(),
});

export type Criterios = z.infer<typeof criteriosSchema>;

const paths = {
  root: process.cwd(),
  dataDir: "data",
  profileDir: "profile",
  criteriosPath: "profile/criterios.json",
  perfilPath: "profile/perfil.md",
  curriculoPath: "profile/curriculo.pdf",
};

function loadCriterios(): Criterios {
  const raw = readFileSync(paths.criteriosPath, "utf-8");
  return criteriosSchema.parse(JSON.parse(raw));
}

export const config = {
  scraperUrl: env.SCRAPER_URL,
  gupyBaseUrl: env.GUPY_BASE_URL,
  anthropicApiKey: env.ANTHROPIC_API_KEY,
  discordWebhookUrl: env.DISCORD_WEBHOOK_URL,
  paths,
  criterios: loadCriterios(),
};
