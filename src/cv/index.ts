import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import type { Job } from "../types.js";
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

export async function gerarCvParaVaga(job: Job): Promise<CvGerado> {
  const estatico = { caminho: config.paths.curriculoPath, score: null, sobMedida: false };

  if (!existsSync(config.paths.cvBasePath)) return estatico;

  try {
    const requisitos = await extrairRequisitos(job);
    const base = carregarCvBase();
    const cv = selecionarCv(base, requisitos);
    const score = calcularAderencia(cv, requisitos);

    const destino = join(config.paths.cvsDir, `${job.id}.pdf`);
    await renderizarPdf(cv, destino);

    console.log(`[cv] ${job.company}: aderência ${score.cobertura}%${score.aderente ? "" : " (abaixo do limiar)"}`);
    return { caminho: destino, score, sobMedida: true };
  } catch (err) {
    console.error(`[cv] falhou para ${job.id}, usando currículo estático: ${err instanceof Error ? err.message.slice(0, 140) : err}`);
    return estatico;
  }
}
