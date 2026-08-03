import { readFileSync } from "node:fs";
import { z } from "zod";
import { normalizarTermo } from "./requisitos.js";
import type {
  Bullet,
  CategoriaSkill,
  CvBase,
  CvSelecionado,
  Experiencia,
  RequisitoVaga,
  RequisitosVaga,
  Idioma,
} from "./types.js";

const CV_BASE_PATH = "profile/cv-base.json";

const bulletSchema = z.object({
  texto: z.string(),
  textoEn: z.string().optional(),
  tags: z.array(z.string()),
  peso: z.number(),
});

const experienciaSchema = z.object({
  empresa: z.string(),
  cargo: z.string(),
  cargoEn: z.string().optional(),
  local: z.string(),
  inicio: z.string(),
  fim: z.string(),
  regime: z.string().optional(),
  bullets: z.array(bulletSchema),
});

const formacaoSchema = z.object({
  curso: z.string(),
  cursoEn: z.string().optional(),
  instituicao: z.string(),
  periodo: z.string(),
  situacao: z.string().optional(),
  situacaoEn: z.string().optional(),
});

const categoriaSkillSchema = z.object({
  categoria: z.string(),
  categoriaEn: z.string().optional(),
  itens: z.array(z.string()),
  tags: z.array(z.string()),
});

const contatoSchema = z.object({
  nome: z.string(),
  cargoPadrao: z.string(),
  cidade: z.string(),
  email: z.string(),
  telefone: z.string(),
  linkedin: z.string(),
  github: z.string(),
});

const cvBaseSchema = z.object({
  contato: contatoSchema,
  titulosAlternativos: z.array(z.object({ titulo: z.string(), tituloEn: z.string().optional(), tags: z.array(z.string()) })),
  resumos: z.array(z.object({ texto: z.string(), textoEn: z.string().optional(), tags: z.array(z.string()) })),
  experiencias: z.array(experienciaSchema),
  skills: z.array(categoriaSkillSchema),
  formacao: z.array(formacaoSchema),
  idiomas: z.array(z.string()),
  idiomasEn: z.array(z.string()).optional(),
});

export function carregarCvBase(): CvBase {
  const raw = readFileSync(CV_BASE_PATH, "utf-8");
  return cvBaseSchema.parse(JSON.parse(raw));
}

function termosCasam(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.includes(a)) return true;
  if (b.length >= 4 && a.includes(b)) return true;
  return false;
}

function variantesRequisito(requisito: RequisitoVaga): string[] {
  return [requisito.termo, ...requisito.sinonimos].flatMap((termo) => normalizarTermo(termo));
}

function requisitoCasaComTags(requisito: RequisitoVaga, tags: string[]): boolean {
  const variantesReq = variantesRequisito(requisito);
  const variantesTags = tags.flatMap((tag) => normalizarTermo(tag));
  return variantesReq.some((vr) => variantesTags.some((vt) => termosCasam(vr, vt)));
}

function calcularMatch(tags: string[], requisitos: RequisitoVaga[]): number {
  return requisitos.reduce((soma, requisito) => {
    if (!requisitoCasaComTags(requisito, tags)) return soma;
    return soma + (requisito.obrigatorio ? 2 : 1);
  }, 0);
}

function selecionarTitulo(base: CvBase, requisitos: RequisitoVaga[]): string {
  let melhorIndice = -1;
  let melhorScore = -1;
  let empatados = 0;

  base.titulosAlternativos.forEach((titulo, indice) => {
    const score = calcularMatch(titulo.tags, requisitos);
    if (score > melhorScore) {
      melhorScore = score;
      melhorIndice = indice;
      empatados = 1;
    } else if (score === melhorScore) {
      empatados += 1;
    }
  });

  if (melhorScore <= 0 || empatados > 1) return base.contato.cargoPadrao;
  return base.titulosAlternativos[melhorIndice].titulo;
}

function selecionarResumo(base: CvBase, requisitos: RequisitoVaga[]): string {
  let melhorIndice = 0;
  let melhorScore = -1;

  base.resumos.forEach((resumo, indice) => {
    const score = calcularMatch(resumo.tags, requisitos);
    if (score > melhorScore) {
      melhorScore = score;
      melhorIndice = indice;
    }
  });

  return base.resumos[melhorIndice].texto;
}

function selecionarBullets(bullets: Bullet[], requisitos: RequisitoVaga[], limite: number): Bullet[] {
  const comScore = bullets.map((bullet) => ({ bullet, score: calcularMatch(bullet.tags, requisitos) }));
  const ordenados = [...comScore].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.bullet.peso - a.bullet.peso;
  });
  return ordenados.slice(0, limite).map((item) => item.bullet);
}

function selecionarExperiencias(base: CvBase, requisitos: RequisitoVaga[]): Experiencia[] {
  return base.experiencias.map((experiencia, indice) => {
    const limite = indice === 0 ? 4 : 3;
    return { ...experiencia, bullets: selecionarBullets(experiencia.bullets, requisitos, limite) };
  });
}

function selecionarSkills(base: CvBase, requisitos: RequisitoVaga[]): CategoriaSkill[] {
  const comScore = base.skills.map((skill, indice) => ({
    skill,
    score: calcularMatch(skill.tags, requisitos),
    indice,
  }));
  const ordenados = [...comScore].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.indice - b.indice;
  });
  return ordenados.slice(0, 6).map((item) => item.skill);
}

function aplicarIdiomaTitulo(base: CvBase, titulo: string, idioma: Idioma): string {
  const achado = base.titulosAlternativos.find((t) => t.titulo === titulo);
  return txt(titulo, achado?.tituloEn, idioma);
}

function aplicarIdiomaResumo(base: CvBase, resumo: string, idioma: Idioma): string {
  const achado = base.resumos.find((r) => r.texto === resumo);
  return txt(resumo, achado?.textoEn, idioma);
}

function traduzirPeriodo(valor: string, idioma: Idioma): string {
  if (idioma !== "en") return valor;
  return valor.replace(/\bAtual\b/gi, "Present").replace(/\bPresente\b/gi, "Present");
}

function traduzirLocal(valor: string, idioma: Idioma): string {
  if (idioma !== "en") return valor;
  return valor.replace(/\bRemoto\b/gi, "Remote").replace(/\bH[íi]brido\b/gi, "Hybrid").replace(/\bPresencial\b/gi, "On-site");
}

function txt(pt: string, en: string | undefined, idioma: Idioma): string {
  return idioma === "en" && en ? en : pt;
}

export function selecionarCv(base: CvBase, req: RequisitosVaga, idioma: Idioma = "pt"): CvSelecionado {
  const requisitos = req.requisitos;
  return {
    idioma,
    contato: base.contato,
    titulo: aplicarIdiomaTitulo(base, selecionarTitulo(base, requisitos), idioma),
    resumo: aplicarIdiomaResumo(base, selecionarResumo(base, requisitos), idioma),
    experiencias: selecionarExperiencias(base, requisitos).map((e) => ({
      ...e,
      cargo: txt(e.cargo, e.cargoEn, idioma),
      fim: traduzirPeriodo(e.fim, idioma),
      local: traduzirLocal(e.local, idioma),
      bullets: e.bullets.map((b) => ({ ...b, texto: txt(b.texto, b.textoEn, idioma) })),
    })),
    skills: selecionarSkills(base, requisitos).map((s) => ({ ...s, categoria: txt(s.categoria, s.categoriaEn, idioma) })),
    formacao: base.formacao.map((f) => ({
      ...f,
      curso: txt(f.curso, f.cursoEn, idioma),
      situacao: f.situacao ? txt(f.situacao, f.situacaoEn, idioma) : undefined,
    })),
    idiomas: idioma === "en" && base.idiomasEn ? base.idiomasEn : base.idiomas,
  };
}
