import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { applications, jobs } from "./db/schema.js";
import { gerarCoverLetter } from "./llm.js";
import type { Job } from "./types.js";

async function postDiscord(content: string): Promise<void> {
  if (!config.discordWebhookUrl) {
    console.log(content);
    return;
  }
  const res = await fetch(config.discordWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook respondeu ${res.status}`);
  }
}

function rowToJob(row: typeof jobs.$inferSelect): Job {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.location,
    url: row.url,
    source: row.source,
    sources: [row.source],
    keyword: row.keyword,
    keywords: [row.keyword],
    description: row.description ?? undefined,
    publishedAt: row.publishedAt ?? undefined,
  };
}

export interface DigestResult {
  enviadas: number;
  descartadasPorScore: number;
  expiradas: number;
}

export async function runDigest(): Promise<DigestResult> {
  const minScore = config.criterios.digestMinScore ?? config.criterios.minScore + 1;
  const validadeDias = config.criterios.digestValidadeDias ?? 7;
  const corte = new Date(Date.now() - validadeDias * 86_400_000).toISOString().slice(0, 19).replace("T", " ");

  const expiradas = db
    .update(applications)
    .set({ status: "skipped", reviewNote: `digest expirado (>${validadeDias} dias sem aplicar)`, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(applications.method, "digest"),
        inArray(applications.status, ["queued", "needs_review"]),
        lt(applications.createdAt, corte),
      ),
    )
    .run().changes;

  const baixoScore = db
    .update(applications)
    .set({ status: "skipped", reviewNote: `abaixo do score mínimo do digest (${minScore})`, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(applications.method, "digest"),
        inArray(applications.status, ["queued", "needs_review"]),
        lt(applications.score, minScore),
        sql`coalesce(${applications.reviewNote}, '') not like '%site de carreira próprio%'`,
      ),
    )
    .run().changes;

  const pending = db
    .select({ application: applications, job: jobs })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(and(eq(applications.method, "digest"), eq(applications.status, "queued")))
    .all();

  if (pending.length === 0) return { enviadas: 0, descartadasPorScore: baixoScore, expiradas };

  await postDiscord(`**Digest de vagas — ${pending.length} para aplicar manualmente**`);

  for (const { application, job } of pending) {
    let coverLetter: string | null = null;
    try {
      coverLetter = await gerarCoverLetter(rowToJob(job));
    } catch (err) {
      console.error(`cover letter falhou para ${job.id}:`, err);
    }

    await postDiscord(
      `**${job.title}** — ${job.company} (score ${application.score}, ${job.source})\n${job.url}`,
    );
    if (coverLetter) {
      await postDiscord(`\`\`\`\n${coverLetter.slice(0, 1900)}\n\`\`\``);
    }

    db.update(applications)
      .set({ status: "needs_review", coverLetter, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(applications.id, application.id))
      .run();
  }

  return { enviadas: pending.length, descartadasPorScore: baixoScore, expiradas };
}
