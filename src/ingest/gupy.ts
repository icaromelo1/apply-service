import { z } from "zod";
import { config } from "../config.js";
import { stableId } from "../lib/stable-id.js";
import type { Job } from "../types.js";

const gupyJobSchema = z.object({
  id: z.number(),
  name: z.string(),
  careerPageName: z.string(),
  description: z.string().optional().default(""),
  publishedDate: z.string().nullish(),
  isRemoteWork: z.boolean().optional().default(false),
  workplaceType: z.string().nullish(),
  city: z.string().optional().default(""),
  state: z.string().optional().default(""),
  country: z.string().optional().default(""),
  jobUrl: z.string(),
});

const gupyResponseSchema = z.object({
  data: z.array(z.unknown()),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  }),
});

const PAGE_SIZE = 50;
const MAX_PAGES_PER_KEYWORD = 2;

function buildLocation(job: z.infer<typeof gupyJobSchema>): string {
  if (job.workplaceType === "remote" || job.isRemoteWork) return "Remoto";
  const cityState = [job.city, job.state].filter(Boolean).join(", ");
  return cityState || job.country || "";
}

async function fetchPage(keyword: string, offset: number) {
  const url = new URL("/api/v1/jobs", config.gupyBaseUrl);
  url.searchParams.set("jobName", keyword);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Gupy respondeu ${res.status} para keyword "${keyword}"`);
  }
  return gupyResponseSchema.parse(await res.json());
}

export async function ingestGupy(): Promise<Job[]> {
  const { keywords, remoteOnly } = config.criterios;
  const byId = new Map<string, Job>();

  for (const keyword of keywords) {
    let offset = 0;
    for (let page = 0; page < MAX_PAGES_PER_KEYWORD; page++) {
      const body = await fetchPage(keyword, offset);

      for (const raw of body.data) {
        const parsed = gupyJobSchema.safeParse(raw);
        if (!parsed.success) continue;
        const gupyJob = parsed.data;

        const isRemote = gupyJob.workplaceType === "remote" || gupyJob.isRemoteWork;
        if (remoteOnly && !isRemote) continue;

        const location = buildLocation(gupyJob);
        const id = stableId(gupyJob.name, gupyJob.careerPageName, location, gupyJob.jobUrl);
        if (!id) continue;

        const existing = byId.get(id);
        if (existing) {
          if (!existing.keywords.includes(keyword)) existing.keywords.push(keyword);
          continue;
        }

        byId.set(id, {
          id,
          title: gupyJob.name,
          company: gupyJob.careerPageName,
          location,
          url: gupyJob.jobUrl,
          source: "Gupy",
          sources: ["Gupy"],
          keyword,
          keywords: [keyword],
          description: gupyJob.description || undefined,
          publishedAt: gupyJob.publishedDate ?? undefined,
        });
      }

      offset += PAGE_SIZE;
      if (offset >= body.pagination.total) break;
    }
  }

  return [...byId.values()];
}
