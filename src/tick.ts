import { resolverEtapasGupy } from "./appliers/gupy-etapas.js";
import { runAppliers } from "./appliers/index.js";
import { closeBrowser } from "./appliers/browser.js";
import { runDigest } from "./digest.js";
import { reportarSaude } from "./saude.js";
import { ingestGupy } from "./ingest/gupy.js";
import { ingestAshby } from "./ingest/ashby.js";
import { ingestLever } from "./ingest/lever.js";
import { ingestScraper } from "./ingest/scraper.js";
import { enqueueJobs } from "./pipeline/queue.js";
import { prune } from "./pipeline/prune.js";
import type { Job } from "./types.js";

async function main(): Promise<void> {
  const LIMITE_MS = Number(process.env.TICK_LIMITE_MIN ?? 75) * 60 * 1000;
const watchdog = setTimeout(() => {
  console.error(`[tick] watchdog: excedeu ${LIMITE_MS / 60000} min, encerrando`);
  process.exit(2);
}, LIMITE_MS);
watchdog.unref();

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

  try {
    const fromLever = await ingestLever();
    console.log(`[ingest] lever: ${fromLever.length} vagas`);
    jobs.push(...fromLever);
  } catch (err) {
    console.error("[ingest] lever falhou:", err instanceof Error ? err.message : err);
  }

  try {
    const fromAshby = await ingestAshby();
    console.log(`[ingest] ashby: ${fromAshby.length} vagas`);
    jobs.push(...fromAshby);
  } catch (err) {
    console.error("[ingest] ashby falhou:", err instanceof Error ? err.message : err);
  }

  const enqueued = enqueueJobs(jobs);
  console.log("[queue]", enqueued);

  const applied = await runAppliers();
  console.log("[appliers]", applied);

  try {
    const etapas = await resolverEtapasGupy();
    console.log("[etapas]", etapas);
  } catch (err) {
    console.error("[etapas] falhou:", err instanceof Error ? err.message : err);
  } finally {
    await reportarSaude().catch((err) => console.error("[saude] falhou:", err));

  clearTimeout(watchdog);
  await closeBrowser();
  }

  try {
    const digested = await runDigest();
    console.log(
      `[digest] ${digested.enviadas} enviadas · ${digested.descartadasPorScore} descartadas por score · ${digested.expiradas} expiradas`,
    );
  } catch (err) {
    console.error("[digest] falhou:", err instanceof Error ? err.message : err);
  }

  if (process.argv.includes("--prune")) {
    console.log("[prune]", prune());
  }

  console.log(`[tick] fim ${new Date().toISOString()}`);
}

await main();
