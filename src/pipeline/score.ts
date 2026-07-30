import type { Criterios } from "../config.js";
import { containsAny, normalizeText } from "../lib/text.js";
import type { Job } from "../types.js";

const JUNIOR_TERMS = ["junior", "júnior", "estagio", "estágio", "trainee", "intern"];
const REMOTE_TERMS = ["remoto", "remote", "home office", "anywhere"];

export function scoreJob(job: Job, criterios: Criterios): number {
  const title = normalizeText(job.title);

  const isJuniorVaga = containsAny(title, JUNIOR_TERMS);
  const aceitaJunior = criterios.senioridade.some((s) => containsAny(s, JUNIOR_TERMS));
  if (isJuniorVaga && !aceitaJunior) return 0;

  let score = 0;

  const keywordInTitle = containsAny(job.title, criterios.keywords);
  const keywordInMeta =
    containsAny(job.keywords.join(" "), criterios.keywords) ||
    (job.description ? containsAny(job.description, criterios.keywords) : false);

  if (keywordInTitle) score += 2;
  else if (keywordInMeta) score += 1;

  if (containsAny(job.title, criterios.senioridade)) score += 1;

  const locationText = `${job.location} ${job.title}`;
  if (containsAny(locationText, REMOTE_TERMS)) score += 1;

  if (containsAny(job.location, criterios.locais)) score += 1;

  return score;
}
