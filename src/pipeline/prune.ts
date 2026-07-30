import { and, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { applications, jobs } from "../db/schema.js";

const RETENTION_DAYS = 30;

function cutoffTimestamp(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
}

export interface PruneResult {
  applicationsDeleted: number;
  jobsDeleted: number;
  descriptionsCleared: number;
}

export function prune(): PruneResult {
  const cutoff = cutoffTimestamp(RETENTION_DAYS);

  const deletedApps = db
    .delete(applications)
    .where(and(inArray(applications.status, ["skipped", "failed"]), lt(applications.updatedAt, cutoff)))
    .run();

  const referencedJobIds = db
    .select({ jobId: applications.jobId })
    .from(applications)
    .all()
    .map((r) => r.jobId);

  const orphanFilter =
    referencedJobIds.length > 0
      ? and(notInArray(jobs.id, referencedJobIds), lt(jobs.lastSeenAt, cutoff))
      : lt(jobs.lastSeenAt, cutoff);

  const deletedJobs = db.delete(jobs).where(orphanFilter).run();

  const terminalJobIds = db
    .select({ jobId: applications.jobId })
    .from(applications)
    .where(inArray(applications.status, ["applied", "skipped", "failed"]))
    .all()
    .map((r) => r.jobId);

  let descriptionsCleared = 0;
  if (terminalJobIds.length > 0) {
    const cleared = db
      .update(jobs)
      .set({ description: null })
      .where(and(inArray(jobs.id, terminalJobIds), isNotNull(jobs.description)))
      .run();
    descriptionsCleared = cleared.changes;
  }

  db.run(sql`VACUUM`);

  return {
    applicationsDeleted: deletedApps.changes,
    jobsDeleted: deletedJobs.changes,
    descriptionsCleared,
  };
}
