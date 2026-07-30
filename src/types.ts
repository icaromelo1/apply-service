export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  source: string;
  sources: string[];
  keyword: string;
  keywords: string[];
  description?: string;
  publishedAt?: string;
}

export type ApplicationStatus = "queued" | "needs_review" | "applied" | "skipped" | "failed";

export type ApplicationMethod = "greenhouse" | "lever" | "gupy" | "digest";
