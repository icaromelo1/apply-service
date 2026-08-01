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

const contagem = new Map<string, number>();
const comAcao = new Map<string, string[]>();

for (const link of links) {
  try {
    await page.goto(link, { waitUntil: "networkidle" });
    await page.locator("text=/Seu [Pp]rogresso/").first().waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const corpo = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
    const progresso = corpo.match(/Seu [Pp]rogresso\s*(\d+)\/(\d+)/);
    if (!progresso) continue;

    const atual = Number(progresso[1]);
    const bloco = corpo.split(/Seu [Pp]rogresso\s*\d+\/\d+/)[1] ?? "";
    const etapas = [...bloco.matchAll(/(\d+)\s*([A-ZÀ-Ú][^0-9]{2,45}?)(?=\s*\d+\s*[A-ZÀ-Ú]|\s*Gupy|\s*$)/g)]
      .map((m) => ({ n: Number(m[1]), nome: m[2].replace(/Termina em:.*/, "").trim() }))
      .filter((e) => e.n >= 1 && e.n <= 15 && e.nome.length > 2);

    for (const e of etapas) contagem.set(e.nome, (contagem.get(e.nome) ?? 0) + 1);

    const acao = page.locator('button:has-text("Começar"), button:has-text("Responder"), button:has-text("Continuar")').first();
    if (await acao.isVisible().catch(() => false)) {
      const etapaAtual = etapas.find((e) => e.n === atual)?.nome ?? "?";
      const lista = comAcao.get(etapaAtual) ?? [];
      lista.push(link);
      comAcao.set(etapaAtual, lista);
    }
  } catch {}
}

console.log("===== NOMES DE ETAPA ENCONTRADOS (frequência) =====");
[...contagem.entries()].sort((a, b) => b[1] - a[1]).forEach(([nome, n]) => console.log(`${n}x  ${nome}`));

console.log("\n===== ETAPAS COM AÇÃO PENDENTE AGORA =====");
for (const [etapa, lista] of comAcao) {
  console.log(`\n[${etapa}] — ${lista.length}`);
  lista.forEach((l) => console.log(`   ${l}`));
}

await browser.close();
