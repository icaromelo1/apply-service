import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "profile/sessions/gupy.json" });
const page = await context.newPage();

await page.goto("https://portal.gupy.io/my/applications", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

const links: string[] = [];
for (let p = 0; p < 10; p++) {
  const anchors = page.locator('a:has-text("Ver andamento")');
  for (let i = 0; i < (await anchors.count()); i++) {
    const href = await anchors.nth(i).getAttribute("href").catch(() => null);
    if (!href) continue;
    const abs = href.startsWith("http") ? href : `https://portal.gupy.io${href}`;
    if (!links.includes(abs)) links.push(abs);
  }
  const next = page.locator('button[aria-label*="róxima" i]:not([disabled]), [aria-label*="next" i]:not([disabled])').first();
  if (!(await next.isVisible().catch(() => false))) break;
  await next.click().catch(() => {});
  await page.waitForTimeout(2000);
}

console.log(`TOTAL DE CANDIDATURAS EM ANDAMENTO: ${links.length}\n`);

const pendentes: string[] = [];
const aguardando: string[] = [];

for (const link of links) {
  try {
    await page.goto(link, { waitUntil: "networkidle" });
    await page
      .locator("text=/Seu [Pp]rogresso/")
      .first()
      .waitFor({ state: "visible", timeout: 25000 })
      .catch(() => {});
    await page.waitForTimeout(1500);

    const titulos = await page
      .locator("h1, h2")
      .filter({ hasNotText: /Hand Talk|acessibilidade/i })
      .allTextContents();
    const titulo = (titulos.find((t) => t.trim().length > 3) ?? "SEM TÍTULO").replace(/\s+/g, " ").trim();
    const corpo = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");

    const progresso = corpo.match(/Seu [Pp]rogresso\s*(\d+\/\d+)/)?.[1] ?? "?";
    const etapaAtual = corpo.match(/Termina em: ([\d/]+)/)?.[1];

    const acao = page.locator('button:has-text("Começar"), button:has-text("Responder"), a:has-text("Começar"), button:has-text("Continuar")').first();
    const temAcao = await acao.isVisible().catch(() => false);

    const etapaNome = corpo.match(/\d+\s*(Currículo|Question[áa]rio|Teste|Avalia[çc][ãa]o[^0-9]{0,30}|Entrevista[^0-9]{0,25}|Bate-papo[^0-9]{0,20}|V[íi]deo[^0-9]{0,20})/i)?.[1]?.trim();

    if (temAcao) {
      const rotulo = (await acao.textContent().catch(() => ""))?.trim();
      pendentes.push(
        `${titulo} | progresso ${progresso} | botão "${rotulo}"${etapaNome ? ` | etapa: ${etapaNome}` : ""}${etapaAtual ? ` | prazo ${etapaAtual}` : ""}\n   ${link}`,
      );
    } else {
      aguardando.push(`${titulo} | progresso ${progresso}${progresso === "?" ? "  <-- PAGINA NAO CARREGOU" : ""}`);
    }
  } catch (err) {
    pendentes.push(`ERRO ao ler ${link}: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(`===== PRECISAM DE AÇÃO (${pendentes.length}) =====`);
pendentes.forEach((p, i) => console.log(`${i + 1}. ${p}`));
console.log(`\n===== SEM PENDÊNCIA — aguardando a empresa (${aguardando.length}) =====`);
aguardando.forEach((a, i) => console.log(`${i + 1}. ${a}`));

await browser.close();
