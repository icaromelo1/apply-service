import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    location: text("location").notNull(),
    url: text("url").notNull(),
    source: text("source").notNull(),
    keyword: text("keyword").notNull(),
    description: text("description"),
    publishedAt: text("published_at"),
    firstSeenAt: text("first_seen_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    companyIdx: index("jobs_company_idx").on(table.company),
  }),
);

export const applications = sqliteTable(
  "applications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    status: text("status", {
      enum: ["queued", "needs_review", "applied", "skipped", "failed"],
    }).notNull(),
    method: text("method", {
      enum: ["greenhouse", "lever", "gupy", "digest"],
    }).notNull(),
    score: integer("score").notNull(),
    coverLetter: text("cover_letter"),
    answers: text("answers"),
    reviewNote: text("review_note"),
    aderencia: integer("aderencia"),
    cvPath: text("cv_path"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    appliedAt: text("applied_at"),
  },
  (table) => ({
    statusIdx: index("applications_status_idx").on(table.status),
    jobIdIdx: uniqueIndex("applications_job_id_idx").on(table.jobId),
  }),
);
