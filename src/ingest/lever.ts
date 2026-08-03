import { readFileSync } from "node:fs";
import { z } from "zod";
import { config } from "../config.js";
import { containsAny } from "../lib/text.js";
import { stableId } from "../lib/stable-id.js";
import type { Job } from "../types.js";

const postingSchema = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string(),
  descriptionPlain: z.string().optional().default(""),
  workplaceType: z.string().nullish(),
  country: z.string().nullish(),
  categories: z
    .object({
      location: z.string().nullish(),
      commitment: z.string().nullish(),
      team: z.string().nullish(),
    })
    .partial()
    .optional(),
});

function carregarEmpresas(): { slug: string; nome: string }[] {
  try {
    const raw = readFileSync(config.paths.leverEmpresasPath, "utf-8");
    return z.array(z.object({ slug: z.string(), nome: z.string() })).parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function ingestLever(): Promise<Job[]> {
  const empresas = carregarEmpresas();
  if (empresas.length === 0) return [];

  const { keywords, remoteOnly } = config.criterios;
  const jobs: Job[] = [];

  for (const empresa of empresas) {
    try {
      const res = await fetch(`https://api.lever.co/v0/postings/${empresa.slug}?mode=json`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;

      const lista = z.array(z.unknown()).parse(await res.json());
      for (const bruto of lista) {
        const parsed = postingSchema.safeParse(bruto);
        if (!parsed.success) continue;
        const p = parsed.data;

        const remoto = /remote/i.test(p.workplaceType ?? "") || /remote/i.test(p.categories?.location ?? "");
        if (remoteOnly && !remoto) continue;

        const texto = `${p.text} ${p.descriptionPlain}`;
        if (!containsAny(texto, keywords)) continue;

        const local = remoto ? "Remoto" : (p.categories?.location ?? "");
        const id = stableId(p.text, empresa.nome, local, p.hostedUrl);
        if (!id) continue;

        jobs.push({
          id,
          title: p.text,
          company: empresa.nome,
          location: local,
          url: p.hostedUrl,
          source: "Lever",
          sources: ["Lever"],
          keyword: keywords.find((k) => containsAny(texto, [k])) ?? keywords[0] ?? "",
          keywords: keywords.filter((k) => containsAny(texto, [k])),
          description: p.descriptionPlain.slice(0, 6000) || undefined,
        });
      }
    } catch (err) {
      console.error(`[lever] ${empresa.slug} falhou:`, err instanceof Error ? err.message.slice(0, 80) : err);
    }
  }

  return jobs;
}
