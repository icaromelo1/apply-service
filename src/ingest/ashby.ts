import { readFileSync } from "node:fs";
import { z } from "zod";
import { config } from "../config.js";
import { containsAny } from "../lib/text.js";
import { stableId } from "../lib/stable-id.js";
import type { Job } from "../types.js";

const postingSchema = z.object({
  id: z.string(),
  title: z.string(),
  location: z.string().nullish(),
  isRemote: z.boolean().nullish(),
  workplaceType: z.string().nullish(),
  isListed: z.boolean().nullish(),
  jobUrl: z.string(),
  applyUrl: z.string().nullish(),
  descriptionPlain: z.string().optional().default(""),
});

function carregarEmpresas(): { slug: string; nome: string }[] {
  try {
    const raw = readFileSync(config.paths.ashbyEmpresasPath, "utf-8");
    return z.array(z.object({ slug: z.string(), nome: z.string() })).parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function ingestAshby(): Promise<Job[]> {
  const empresas = carregarEmpresas();
  if (empresas.length === 0) return [];

  const { keywords, remoteOnly } = config.criterios;
  const jobs: Job[] = [];

  for (const empresa of empresas) {
    try {
      const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${empresa.slug}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;

      const corpo = z.object({ jobs: z.array(z.unknown()).optional() }).parse(await res.json());
      for (const bruto of corpo.jobs ?? []) {
        const parsed = postingSchema.safeParse(bruto);
        if (!parsed.success) continue;
        const p = parsed.data;
        if (p.isListed === false) continue;

        const remoto = p.isRemote === true || /remote/i.test(p.workplaceType ?? "");
        if (remoteOnly && !remoto) continue;

        const texto = `${p.title} ${p.descriptionPlain}`;
        if (!containsAny(texto, keywords)) continue;

        const local = remoto ? "Remoto" : (p.location ?? "");
        const url = p.applyUrl ?? p.jobUrl;
        const id = stableId(p.title, empresa.nome, local, url);
        if (!id) continue;

        jobs.push({
          id,
          title: p.title,
          company: empresa.nome,
          location: local,
          url,
          source: "Ashby",
          sources: ["Ashby"],
          keyword: keywords.find((k) => containsAny(texto, [k])) ?? keywords[0] ?? "",
          keywords: keywords.filter((k) => containsAny(texto, [k])),
          description: p.descriptionPlain.slice(0, 6000) || undefined,
        });
      }
    } catch (err) {
      console.error(`[ashby] ${empresa.slug} falhou:`, err instanceof Error ? err.message.slice(0, 80) : err);
    }
  }

  return jobs;
}
