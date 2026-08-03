export interface Contato {
  nome: string;
  cargoPadrao: string;
  cidade: string;
  email: string;
  telefone: string;
  linkedin: string;
  github: string;
}

export interface Bullet {
  texto: string;
  tags: string[];
  peso: number;
}

export interface Experiencia {
  empresa: string;
  cargo: string;
  local: string;
  inicio: string;
  fim: string;
  regime?: string;
  bullets: Bullet[];
}

export interface Formacao {
  curso: string;
  instituicao: string;
  periodo: string;
  situacao?: string;
}

export interface CategoriaSkill {
  categoria: string;
  itens: string[];
  tags: string[];
}

export interface CvBase {
  contato: Contato;
  titulosAlternativos: { titulo: string; tags: string[] }[];
  resumos: { texto: string; tags: string[] }[];
  experiencias: Experiencia[];
  skills: CategoriaSkill[];
  formacao: Formacao[];
  idiomas: string[];
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
