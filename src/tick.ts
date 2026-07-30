import { runAppliers } from "./appliers/index.js";
import { runDigest } from "./digest.js";
import { ingestGupy } from "./ingest/gupy.js";
import { ingestScraper } from "./ingest/scraper.js";
import { enqueueJobs } from "./pipeline/queue.js";
import { prune } from "./pipeline/prune.js";
import type { Job } from "./types.js";

async function main(): Promise<void> {
  console.log(`[tick] início ${new Date().toISOString()}`);

  const jobs: Job[] = [];

  try {
    const fromScraper = await ingestScraper();
    console.log(`[ingest] scraper: ${fromScraper.length} vagas`);
    jobs.push(...fromScraper);
  } catch (err) {
    console.error("[ingest] scraper falhou:", err instanceof Error ? err.message : err);
  }

  try {
    const fromGupy = await ingestGupy();
    console.log(`[ingest] gupy: ${fromGupy.length} vagas`);
    jobs.push(...fromGupy);
  } catch (err) {
    console.error("[ingest] gupy falhou:", err instanceof Error ? err.message : err);
  }

  const enqueued = enqueueJobs(jobs);
  console.log("[queue]", enqueued);

  const applied = await runAppliers();
  console.log("[appliers]", applied);

  try {
    const digested = await runDigest();
    console.log(`[digest] ${digested} vagas no digest`);
  } catch (err) {
    console.error("[digest] falhou:", err instanceof Error ? err.message : err);
  }

  if (process.argv.includes("--prune")) {
    console.log("[prune]", prune());
  }

  console.log(`[tick] fim ${new Date().toISOString()}`);
}

await main();
