import { like, or } from "drizzle-orm";
import { db } from "./db/index.js";
import { applications, jobs } from "./db/schema.js";
import { eq } from "drizzle-orm";

const rows = db
  .select({ note: applications.reviewNote, title: jobs.title, company: jobs.company, url: jobs.url })
  .from(applications)
  .innerJoin(jobs, eq(jobs.id, applications.jobId))
  .where(or(like(applications.reviewNote, "%DADO FALTANDO%"), like(applications.reviewNote, "%sem resposta no perfil%")))
  .all();

const porPergunta = new Map<string, { empresas: string[]; url: string }>();

for (const row of rows) {
  const perguntas = [...(row.note ?? "").matchAll(/"([^"]{8,})"/g)].map((m) => m[1]);
  for (const p of perguntas) {
    const chave = p.slice(0, 70);
    const item = porPergunta.get(chave) ?? { empresas: [], url: row.url };
    if (!item.empresas.includes(row.company)) item.empresas.push(row.company);
    porPergunta.set(chave, item);
  }
}

if (porPergunta.size === 0) {
  console.log("Nenhum dado faltando — todas as candidaturas com informação suficiente.");
} else {
  console.log(`===== DADOS QUE FALTAM NO PERFIL (${porPergunta.size}) =====\n`);
  [...porPergunta.entries()]
    .sort((a, b) => b[1].empresas.length - a[1].empresas.length)
    .forEach(([pergunta, info], i) => {
      console.log(`${i + 1}. "${pergunta}"`);
      console.log(`   trava ${info.empresas.length} candidatura(s): ${info.empresas.slice(0, 5).join(", ")}\n`);
    });
}
