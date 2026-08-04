import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import type { Job } from "../types.js";
import { detectarIdioma } from "./idioma.js";
import { extrairRequisitos } from "./requisitos.js";
import { renderizarPdf } from "./render.js";
import { calcularAderencia } from "./score.js";
import { carregarCvBase, selecionarCv } from "./select.js";
import type { ScoreAderencia } from "./types.js";

export interface CvGerado {
  caminho: string;
  score: ScoreAderencia | null;
  sobMedida: boolean;
}

function pastaDaVaga(job: Job): string {
  const bruto = job.id.replace(/^https?:\/\//, "").replace(/[^\w.-]+/g, "_");
  return bruto.slice(0, 80) || "vaga";
}

function nomeDoArquivo(): string {
  const candidato = config.candidato;
  const partes = [candidato?.nome, candidato?.sobrenome].filter(Boolean).join(" ").trim();
  const base = partes
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  return `${base || "Curriculo"}_CV.pdf`;
}

export async function gerarCvParaVaga(job: Job): Promise<CvGerado> {
  const estatico = { caminho: config.paths.curriculoPath, score: null, sobMedida: false };

  if (!existsSync(config.paths.cvBasePath)) return estatico;

  try {
    const requisitos = await extrairRequisitos(job);
    const base = carregarCvBase();
    const idioma = detectarIdioma(job);
    const cv = selecionarCv(base, requisitos, idioma);
    const score = calcularAderencia(cv, requisitos);

    const destino = join(config.paths.cvsDir, pastaDaVaga(job), nomeDoArquivo());
    await renderizarPdf(cv, destino);

    console.log(`[cv] ${job.company}: aderência ${score.cobertura}% (${idioma})${score.aderente ? "" : " (abaixo do limiar)"}`);
    return { caminho: destino, score, sobMedida: true };
  } catch (err) {
    console.error(`[cv] falhou para ${job.id}, usando currículo estático: ${err instanceof Error ? err.message.slice(0, 140) : err}`);
    return estatico;
  }
}
