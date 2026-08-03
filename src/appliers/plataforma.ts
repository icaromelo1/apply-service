export type Plataforma = "greenhouse" | "lever" | "ashby" | "workable" | "gupy" | "desconhecida";

const POR_DOMINIO: { padrao: RegExp; plataforma: Plataforma }[] = [
  { padrao: /greenhouse\.io|gh_jid=|gh_src=/i, plataforma: "greenhouse" },
  { padrao: /jobs\.lever\.co|lever\.co\/[^/]+\/[0-9a-f-]{8}/i, plataforma: "lever" },
  { padrao: /jobs\.ashbyhq\.com|ashbyhq\.com/i, plataforma: "ashby" },
  { padrao: /apply\.workable\.com|workable\.com/i, plataforma: "workable" },
  { padrao: /\.gupy\.io|gupy\.io/i, plataforma: "gupy" },
];

export function detectarPlataforma(url: string): Plataforma {
  for (const { padrao, plataforma } of POR_DOMINIO) {
    if (padrao.test(url)) return plataforma;
  }
  return "desconhecida";
}

export function normalizarFonte(source: string): string {
  return source
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
