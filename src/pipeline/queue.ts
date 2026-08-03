import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { applications, jobs } from "../db/schema.js";
import { detectarPlataforma, normalizarFonte } from "../appliers/plataforma.js";
import type { ApplicationMethod, Job } from "../types.js";
import { scoreJob } from "./score.js";

const METODO_POR_PLATAFORMA: Record<string, ApplicationMethod> = {
  greenhouse: "greenhouse",
  lever: "lever",
  ashby: "ashby",
  workable: "workable",
  gupy: "gupy",
};

function methodFor(job: Job): ApplicationMethod {
  const porUrl = METODO_POR_PLATAFORMA[detectarPlataforma(job.url)];
  if (porUrl) return porUrl;
  return METODO_POR_PLATAFORMA[normalizarFonte(job.source)] ?? "digest";
}

function cutoffTimestamp(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
}

export interface EnqueueResult {
  enqueued: number;
  skippedExisting: number;
  skippedLowScore: number;
  skippedCooldown: number;
  skippedByCap: number;
}

export function enqueueJobs(incoming: Job[]): EnqueueResult {
  const { minScore, tetoDiario, cooldownEmpresaDias } = config.criterios;
  const result: EnqueueResult = {
    enqueued: 0,
    skippedExisting: 0,
    skippedLowScore: 0,
    skippedCooldown: 0,
    skippedByCap: 0,
  };

  const scored = incoming
    .map((job) => ({ job, score: scoreJob(job, config.criterios) }))
    .sort((a, b) => b.score - a.score);

  const existingIds = new Set(
    incoming.length > 0
      ? db
          .select({ jobId: applications.jobId })
          .from(applications)
          .where(inArray(applications.jobId, incoming.map((j) => j.id)))
          .all()
          .map((r) => r.jobId)
      : [],
  );

  const cooldownCutoff = cutoffTimestamp(cooldownEmpresaDias);
  const companiesEmCooldown = new Set(
    db
      .select({ company: jobs.company })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .where(gte(applications.createdAt, cooldownCutoff))
      .all()
      .map((r) => r.company.toLowerCase()),
  );

  const todayCount = db
    .select({ count: sql<number>`count(*)` })
    .from(applications)
    .where(and(sql`date(created_at) = date('now')`, inArray(applications.status, ["queued", "applied", "needs_review"])))
    .get();
  let remainingToday = Math.max(0, tetoDiario - (todayCount?.count ?? 0));

  for (const { job, score } of scored) {
    if (existingIds.has(job.id)) {
      db.update(jobs)
        .set({ lastSeenAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(jobs.id, job.id))
        .run();
      result.skippedExisting++;
      continue;
    }

    if (score < minScore) {
      result.skippedLowScore++;
      continue;
    }

    const companyKey = job.company.toLowerCase();
    if (companiesEmCooldown.has(companyKey)) {
      result.skippedCooldown++;
      continue;
    }

    if (remainingToday <= 0) {
      result.skippedByCap++;
      continue;
    }

    db.insert(jobs)
      .values({
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
        source: job.source,
        keyword: job.keyword,
        description: job.description ?? null,
        publishedAt: job.publishedAt ?? null,
      })
      .onConflictDoUpdate({
        target: jobs.id,
        set: { lastSeenAt: sql`CURRENT_TIMESTAMP`, description: job.description ?? null },
      })
      .run();

    db.insert(applications)
      .values({ jobId: job.id, status: "queued", method: methodFor(job), score })
      .run();

    companiesEmCooldown.add(companyKey);
    remainingToday--;
    result.enqueued++;
  }

  return result;
}
