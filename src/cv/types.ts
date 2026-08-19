export interface Contato {
  nome: string;
  cargoPadrao: string;
  cidade: string;
  email: string;
  telefone: string;
  linkedin: string;
  github: string;
  portfolio?: string;
}

export type Idioma = "pt" | "en";

export interface Bullet {
  texto: string;
  textoEn?: string;
  tags: string[];
  peso: number;
}

export interface Experiencia {
  empresa: string;
  cargo: string;
  cargoEn?: string;
  local: string;
  inicio: string;
  fim: string;
  regime?: string;
  bullets: Bullet[];
}

export interface Formacao {
  curso: string;
  cursoEn?: string;
  instituicao: string;
  periodo: string;
  situacao?: string;
  situacaoEn?: string;
}

export interface CategoriaSkill {
  categoria: string;
  categoriaEn?: string;
  itens: string[];
  tags: string[];
}

export interface CvBase {
  contato: Contato;
  titulosAlternativos: { titulo: string; tituloEn?: string; tags: string[] }[];
  resumos: { texto: string; textoEn?: string; tags: string[] }[];
  experiencias: Experiencia[];
  skills: CategoriaSkill[];
  formacao: Formacao[];
  idiomas: string[];
  idiomasEn?: string[];
}

export interface RequisitosVagaIdioma {
  idioma: Idioma;
}

export interface RequisitoVaga {
  termo: string;
  obrigatorio: boolean;
  sinonimos: string[];
}

export interface RequisitosVaga {
  cargo: string;
  requisitos: RequisitoVaga[];
}

export interface CvSelecionado {
  contato: Contato;
  idioma: Idioma;
  titulo: string;
  resumo: string;
  experiencias: Experiencia[];
  skills: CategoriaSkill[];
  formacao: Formacao[];
  idiomas: string[];
}

export interface ScoreAderencia {
  cobertura: number;
  obrigatoriosCobertos: string[];
  obrigatoriosFaltando: string[];
  aderente: boolean;
}
