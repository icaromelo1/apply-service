import { and, eq, sql } from "drizzle-orm";
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

export async function runDigest(): Promise<number> {
  const pending = db
    .select({ application: applications, job: jobs })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(and(eq(applications.method, "digest"), eq(applications.status, "queued")))
    .all();

  if (pending.length === 0) return 0;

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

  return pending.length;
}
