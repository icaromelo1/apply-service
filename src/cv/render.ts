import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import type { CvSelecionado } from "./types.js";

const SECOES = {
  pt: { resumo: "RESUMO PROFISSIONAL", exp: "EXPERIÊNCIA PROFISSIONAL", skills: "COMPETÊNCIAS TÉCNICAS", form: "FORMAÇÃO", idiomas: "IDIOMAS", atual: "Atual" },
  en: { resumo: "PROFESSIONAL SUMMARY", exp: "PROFESSIONAL EXPERIENCE", skills: "TECHNICAL SKILLS", form: "EDUCATION", idiomas: "LANGUAGES", atual: "Present" },
} as const;

function secoes(cv: CvSelecionado) {
  return SECOES[cv.idioma ?? "pt"];
}

function esc(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function montarContato(cv: CvSelecionado): string {
  const partes = [
    cv.contato.cidade,
    cv.contato.email,
    cv.contato.telefone,
    cv.contato.linkedin,
    cv.contato.github,
  ].filter((p) => p && p.trim().length > 0);
  return partes.map(esc).join(" &middot; ");
}

function montarResumo(cv: CvSelecionado): string {
  const t = secoes(cv);
  if (!cv.resumo || cv.resumo.trim().length === 0) return "";
  return `
    <section>
      <h2>${t.resumo}</h2>
      <p>${esc(cv.resumo)}</p>
    </section>
  `;
}

function montarExperiencias(cv: CvSelecionado): string {
  const t = secoes(cv);
  if (cv.experiencias.length === 0) return "";
  const itens = cv.experiencias
    .map((exp) => {
      const periodo = `${esc(exp.inicio)} - ${esc(exp.fim)}`;
      const local = exp.local ? ` &middot; ${esc(exp.local)}` : "";
      const regime = exp.regime ? ` &middot; ${esc(exp.regime)}` : "";
      const bullets = exp.bullets
        .map((b) => `<li>${esc(b.texto)}</li>`)
        .join("\n");
      return `
        <article>
          <h3>${esc(exp.cargo)} &mdash; ${esc(exp.empresa)}</h3>
          <p class="meta">${periodo}${local}${regime}</p>
          ${bullets ? `<ul>${bullets}</ul>` : ""}
        </article>
      `;
    })
    .join("\n");
  return `
    <section>
      <h2>${t.exp}</h2>
      ${itens}
    </section>
  `;
}

function montarSkills(cv: CvSelecionado): string {
  const t = secoes(cv);
  if (cv.skills.length === 0) return "";
  const itens = cv.skills
    .map((cat) => {
      const lista = cat.itens.map(esc).join(", ");
      return `<li><strong>${esc(cat.categoria)}:</strong> ${lista}</li>`;
    })
    .join("\n");
  return `
    <section>
      <h2>${t.skills}</h2>
      <ul>${itens}</ul>
    </section>
  `;
}

function montarFormacao(cv: CvSelecionado): string {
  const t = secoes(cv);
  if (cv.formacao.length === 0) return "";
  const itens = cv.formacao
    .map((f) => {
      const situacao = f.situacao ? ` &middot; ${esc(f.situacao)}` : "";
      return `
        <article>
          <h3>${esc(f.curso)} &mdash; ${esc(f.instituicao)}</h3>
          <p class="meta">${esc(f.periodo)}${situacao}</p>
        </article>
      `;
    })
    .join("\n");
  return `
    <section>
      <h2>${t.form}</h2>
      ${itens}
    </section>
  `;
}

function montarIdiomas(cv: CvSelecionado): string {
  const t = secoes(cv);
  if (cv.idiomas.length === 0) return "";
  const itens = cv.idiomas.map((i) => `<li>${esc(i)}</li>`).join("\n");
  return `
    <section>
      <h2>${t.idiomas}</h2>
      <ul>${itens}</ul>
    </section>
  `;
}

export function montarHtml(cv: CvSelecionado): string {
  const t = SECOES[cv.idioma ?? "pt"];
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>${esc(cv.contato.nome)}</title>
        <style>
          * {
            box-sizing: border-box;
          }
          body {
            font-family: Helvetica, Arial, sans-serif;
            font-size: 11pt;
            line-height: 1.5;
            color: #000000;
            background-color: #ffffff;
            margin: 0;
            padding: 0;
          }
          header {
            margin-bottom: 16px;
          }
          header h1 {
            font-size: 18pt;
            margin: 0 0 2px 0;
          }
          header .titulo {
            font-size: 12pt;
            margin: 0 0 6px 0;
          }
          header .contato {
            font-size: 10pt;
            margin: 0;
          }
          h2 {
            font-size: 12pt;
            text-transform: uppercase;
            border-bottom: 1px solid #000000;
            padding-bottom: 2px;
            margin: 16px 0 8px 0;
          }
          h3 {
            font-size: 11pt;
            margin: 10px 0 2px 0;
          }
          p {
            margin: 4px 0;
          }
          p.meta {
            font-size: 10pt;
            margin: 0 0 4px 0;
          }
          ul {
            margin: 4px 0;
            padding-left: 18px;
          }
          li {
            margin: 2px 0;
          }
          section {
            page-break-inside: avoid;
          }
        </style>
      </head>
      <body>
        <header>
          <h1>${esc(cv.contato.nome)}</h1>
          <p class="titulo">${esc(cv.titulo)}</p>
          <p class="contato">${montarContato(cv)}</p>
        </header>
        ${montarResumo(cv)}
        ${montarExperiencias(cv)}
        ${montarSkills(cv)}
        ${montarFormacao(cv)}
        ${montarIdiomas(cv)}
      </body>
    </html>
  `;
}

export async function renderizarPdf(cv: CvSelecionado, destino: string): Promise<string> {
  mkdirSync(dirname(destino), { recursive: true });
  const html = montarHtml(cv);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: destino,
      format: "A4",
      printBackground: false,
      margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
    });
  } finally {
    await browser.close();
  }
  return destino;
}
