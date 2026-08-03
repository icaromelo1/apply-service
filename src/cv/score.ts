import { normalizeText } from "../lib/text.js";
import { normalizarTermo } from "./requisitos.js";
import type { CvSelecionado, RequisitoVaga, RequisitosVaga, ScoreAderencia } from "./types.js";

function montarBlob(cv: CvSelecionado): string {
  const partes: string[] = [
    cv.titulo,
    cv.resumo,
    ...cv.experiencias.flatMap((e) => [e.cargo, ...e.bullets.map((b) => b.texto)]),
    ...cv.skills.flatMap((s) => s.itens),
  ];
  return normalizeText(partes.join(" "));
}

function semPontuacao(s: string): string {
  return s.replace(/[.\-_/\\+#]/g, "");
}

const IRRELEVANTES = new Set(["de", "da", "do", "e", "em", "com", "para", "a", "o", "the", "and", "of"]);

function apareceNoBlob(blob: string, variante: string): boolean {
  const termo = variante.trim();
  if (!termo) return false;

  const palavras = termo.split(/\s+/).filter((p) => p.length > 1 && !IRRELEVANTES.has(p));
  if (palavras.length > 1) {
    return palavras.every((p) => apareceNoBlob(blob, p));
  }

  if (termo.length >= 4) {
    return blob.includes(termo) || semPontuacao(blob).includes(semPontuacao(termo));
  }
  const escapado = termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|[^a-z0-9])${escapado}($|[^a-z0-9])`, "i");
  return regex.test(blob);
}

function termoCoberto(blob: string, requisito: RequisitoVaga): boolean {
  const variantes = new Set<string>();
  for (const variante of normalizarTermo(requisito.termo)) variantes.add(variante);
  for (const sinonimo of requisito.sinonimos) {
    for (const variante of normalizarTermo(sinonimo)) variantes.add(variante);
  }
  return [...variantes].some((variante) => apareceNoBlob(blob, variante));
}

export function calcularAderencia(cv: CvSelecionado, req: RequisitosVaga, limiar = 75): ScoreAderencia {
  const blob = montarBlob(cv);
  const coberturaPorRequisito = new Map(req.requisitos.map((r) => [r, termoCoberto(blob, r)] as const));

  const obrigatorios = req.requisitos.filter((r) => r.obrigatorio);
  const obrigatoriosCobertos = obrigatorios.filter((r) => coberturaPorRequisito.get(r)).map((r) => r.termo);
  const obrigatoriosFaltando = obrigatorios.filter((r) => !coberturaPorRequisito.get(r)).map((r) => r.termo);

  const base = obrigatorios.length > 0 ? obrigatorios : req.requisitos;
  const cobertura =
    base.length === 0
      ? 100
      : Math.round((base.filter((r) => coberturaPorRequisito.get(r)).length / base.length) * 100);

  return {
    cobertura,
    obrigatoriosCobertos,
    obrigatoriosFaltando,
    aderente: cobertura >= limiar,
  };
}
