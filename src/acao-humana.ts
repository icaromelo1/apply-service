import { chromium } from "playwright";

const HUMANA = /entrevista|test|case|desafio|din[âa]mica|v[íi]deo|bate.?papo|avalia[çc][ãa]o t[ée]cnica|l[óo]gica|oferta|proposta|admiss/i;

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

const precisaVoce: string[] = [];
const avancou: string[] = [];

for (const link of links) {
  try {
    await page.goto(link, { waitUntil: "networkidle" });
    await page.locator("text=/Seu [Pp]rogresso/").first().waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const titulos = await page.locator("h1, h2").filter({ hasNotText: /Hand Talk|acessibilidade/i }).allTextContents();
    const titulo = (titulos.find((t) => t.trim().length > 3) ?? "?").replace(/\s+/g, " ").trim();
    const corpo = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");

    const prog = corpo.match(/Seu [Pp]rogresso\s*(\d+)\/(\d+)/);
    if (!prog) continue;
    const atual = Number(prog[1]);

    const bloco = corpo.split(/Seu [Pp]rogresso\s*\d+\/\d+/)[1] ?? "";
    const etapas = [...bloco.matchAll(/(\d+)\s*([A-ZÀ-Ú][^0-9]{2,45}?)(?=\s*\d+\s*[A-ZÀ-Ú]|\s*Gupy|\s*$)/g)]
      .map((m) => ({ n: Number(m[1]), nome: m[2].replace(/Termina em:.*/, "").trim() }))
      .filter((e) => e.n >= 1 && e.n <= 15);

    const etapaAtual = etapas.find((e) => e.n === atual)?.nome ?? "?";
    const prazo = corpo.match(/Termina em: ([\d/]+)/)?.[1];
    const acao = page.locator('button:has-text("Começar"), button:has-text("Responder"), button:has-text("Continuar"), button:has-text("Agendar"), button:has-text("Acessar")').first();
    const temAcao = await acao.isVisible().catch(() => false);

    if (atual > 1) {
      avancou.push(`${titulo} — etapa ${atual}/${prog[2]}: ${etapaAtual}`);
    }

    if (temAcao && HUMANA.test(etapaAtual)) {
      const rotulo = (await acao.textContent().catch(() => ""))?.trim();
      precisaVoce.push(`${titulo}\n   etapa ${atual}/${prog[2]}: ${etapaAtual} | botão "${rotulo}"${prazo ? ` | PRAZO ${prazo}` : ""}\n   ${link}`);
    }
  } catch {}
}

console.log(`===== PRECISA DE VOCÊ — entrevista/teste/case (${precisaVoce.length}) =====`);
precisaVoce.forEach((p, i) => console.log(`\n${i + 1}. ${p}`));

console.log(`\n\n===== JÁ PASSARAM DA PRIMEIRA ETAPA (${avancou.length}) =====`);
avancou.forEach((a, i) => console.log(`${i + 1}. ${a}`));

await browser.close();
