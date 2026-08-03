import { anotarNoPainel, lerRespostas, type Classe } from "./inbox/respostas.js";

const dias = Number(process.argv.find((a) => /^--dias=/.test(a))?.split("=")[1] ?? 14);
const anotar = process.argv.includes("--anotar");

const ROTULO: Record<Classe, string> = {
  entrevista: "ENTREVISTA",
  teste: "TESTE",
  recusa: "RECUSA",
  pendencia: "PENDENTE",
  recebida: "recebida",
  outro: "outro",
};

const ORDEM: Classe[] = ["entrevista", "teste", "recusa", "pendencia", "recebida", "outro"];

const respostas = await lerRespostas(dias);

if (respostas.length === 0) {
  console.log(`Nenhuma resposta de processo seletivo nos últimos ${dias} dias.`);
} else {
  for (const classe of ORDEM) {
    const grupo = respostas.filter((r) => r.classe === classe);
    if (grupo.length === 0) continue;

    console.log(`\n${ROTULO[classe]} (${grupo.length})`);
    for (const r of grupo) {
      const dia = r.data.toISOString().slice(5, 10);
      const quem = r.empresa ?? r.remetente;
      console.log(`   ${dia}  ${quem.slice(0, 26).padEnd(26)}  ${r.assunto.slice(0, 78)}`);
    }
  }

  const acionaveis = respostas.filter((r) => r.classe === "entrevista" || r.classe === "teste").length;
  console.log(`\nTotal: ${respostas.length} · ${acionaveis} exigem ação sua`);
}

if (anotar) {
  const n = anotarNoPainel(respostas);
  console.log(`${n} candidatura(s) atualizadas no painel`);
}
