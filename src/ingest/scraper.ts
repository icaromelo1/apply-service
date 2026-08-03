import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { config } from "../config.js";
import type { Job } from "../types.js";

const scrapeJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string().optional().default(""),
  location: z.string().optional().default(""),
  url: z.string(),
  source: z.string(),
  sources: z.array(z.string()).optional().default([]),
  keyword: z.string().optional().default(""),
  keywords: z.array(z.string()).optional().default([]),
  description: z.string().nullish(),
  publishedAt: z.string().nullish(),
});

const scrapeResponseSchema = z.object({
  jobs: z.array(z.unknown()).nullable().default([]),
  total: z.number().optional(),
});

async function isHealthy(): Promise<boolean> {
  try {
    const res = await fetch(new URL("/health", config.scraperUrl), {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureScraperUp(): Promise<void> {
  if (await isHealthy()) return;

  const composeDir = process.env.SCRAPER_COMPOSE_DIR;
  if (!composeDir) {
    throw new Error(`scraper indisponível em ${config.scraperUrl} e SCRAPER_COMPOSE_DIR não definido`);
  }

  execFileSync("docker", ["compose", "up", "-d"], { cwd: composeDir, stdio: "inherit" });

  for (let attempt = 0; attempt < 12; attempt++) {
    await sleep(5000);
    if (await isHealthy()) return;
  }
  throw new Error(`scraper não ficou saudável em ${config.scraperUrl} após docker compose up`);
}

export async function ingestScraper(): Promise<Job[]> {
  await ensureScraperUp();

  const { keywords, searchKeywords, remoteOnly, locais } = config.criterios;
  const termos = searchKeywords && searchKeywords.length > 0 ? searchKeywords : keywords;
  const janela = process.env.SCRAPER_TIME_FILTER ?? "r604800";
  const paginas = Number(process.env.SCRAPER_MAX_PAGES ?? 4);
  const alvos = locais.length > 0 ? locais : ["Brasil"];

  const brutos: unknown[] = [];

  for (const local of alvos) {
    const res = await fetch(new URL("/scrape", config.scraperUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keywords: termos,
        remoteOnly,
        searchLocation: local,
        timeFilter: janela,
        resultsPerPage: 25,
        maxPagesPerKeyword: paginas,
      }),
      signal: AbortSignal.timeout(20 * 60 * 1000),
    });

    if (!res.ok) {
      console.error(`[scraper] ${local} respondeu ${res.status}`);
      continue;
    }

    const body = scrapeResponseSchema.parse(await res.json());
    const achadas = body.jobs ?? [];
    console.log(`[scraper] ${local}: ${achadas.length} vagas (janela ${janela}, ${paginas} páginas)`);
    brutos.push(...achadas);
  }

  if (brutos.length === 0) {
    throw new Error("scraper não retornou vagas em nenhuma localização");
  }

  const jobs: Job[] = [];
  const vistos = new Set<string>();

  for (const raw of brutos) {
    const parsed = scrapeJobSchema.safeParse(raw);
    if (!parsed.success) continue;
    const j = parsed.data;
    if (!j.id || vistos.has(j.id)) continue;
    vistos.add(j.id);

    jobs.push({
      id: j.id,
      title: j.title,
      company: j.company,
      location: j.location,
      url: j.url,
      source: j.source,
      sources: j.sources.length > 0 ? j.sources : [j.source],
      keyword: j.keyword || j.keywords[0] || "",
      keywords: j.keywords.length > 0 ? j.keywords : [j.keyword].filter(Boolean),
      description: j.description ?? undefined,
      publishedAt: j.publishedAt ?? undefined,
    });
  }

  return jobs;
}
