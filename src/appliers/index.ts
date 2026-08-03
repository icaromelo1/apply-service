import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { applications, jobs } from "../db/schema.js";
import type { Job } from "../types.js";
import { closeBrowser, type ApplyOutcome } from "./browser.js";
import { applyGreenhouse } from "./greenhouse.js";
import { applyGupy } from "./gupy.js";
import { applyLever } from "./lever.js";

const APPLIERS: Record<string, (applicationId: number, job: Job) => Promise<ApplyOutcome>> = {
  greenhouse: applyGreenhouse,
  lever: applyLever,
  gupy: applyGupy,
};

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

export interface ApplierRunResult {
  applied: number;
  descartadas: number;
  needsReview: number;
  failed: number;
}

export async function runAppliers(): Promise<ApplierRunResult> {
  const pending = db
    .select({ application: applications, job: jobs })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(and(eq(applications.status, "queued"), inArray(applications.method, ["greenhouse", "lever", "ashby", "workable", "gupy"])))
    .all();

  const result: ApplierRunResult = { applied: 0, descartadas: 0, needsReview: 0, failed: 0 };

  try {
    for (const { application, job } of pending) {
      const applier = APPLIERS[application.method];
      if (!applier) continue;

      console.log(`[applier:${application.method}] ${job.title} — ${job.company}`);
      const outcome = await applier(application.id, rowToJob(job));

      db.update(applications)
        .set({
          status: outcome.status,
          reviewNote: outcome.note ?? null,
          aderencia: outcome.aderencia ?? null,
          cvPath: outcome.cvPath ?? null,
          answers: outcome.answers ?? null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
          appliedAt: outcome.status === "applied" ? sql`CURRENT_TIMESTAMP` : null,
        })
        .where(eq(applications.id, application.id))
        .run();

      if (outcome.status === "applied") result.applied++;
      else if (outcome.status === "skipped") result.descartadas++;
      else if (outcome.status === "needs_review") result.needsReview++;
      else result.failed++;
    }
  } finally {
    await closeBrowser();
  }

  return result;
}
