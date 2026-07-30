import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { config } from "../config.js";

const MARKER = process.env.GUPY_LOGIN_MARKER;

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto("https://portal.gupy.io/");
console.log("Faça login na Gupy na janela do browser (Google/e-mail).");

if (MARKER) {
  console.log(`Aguardando o marcador ${MARKER} para salvar a sessão (timeout 15min)...`);
  const deadline = Date.now() + 15 * 60 * 1000;
  while (!existsSync(MARKER)) {
    if (Date.now() > deadline) {
      console.error("timeout aguardando login");
      await browser.close();
      process.exit(1);
    }
    await sleep(3000);
  }
  rmSync(MARKER);
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("Quando estiver logado, pressione Enter aqui para salvar a sessão... ");
  rl.close();
}

mkdirSync(dirname(config.paths.gupySessionPath), { recursive: true });
await context.storageState({ path: config.paths.gupySessionPath });
console.log(`Sessão salva em ${config.paths.gupySessionPath}`);

await browser.close();
