import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { chromium } from "playwright";
import { config } from "../config.js";

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto("https://portal.gupy.io/");
console.log("Faça login na Gupy na janela do browser (Google/e-mail).");

const rl = createInterface({ input: process.stdin, output: process.stdout });
await rl.question("Quando estiver logado, pressione Enter aqui para salvar a sessão... ");
rl.close();

mkdirSync(dirname(config.paths.gupySessionPath), { recursive: true });
await context.storageState({ path: config.paths.gupySessionPath });
console.log(`Sessão salva em ${config.paths.gupySessionPath}`);

await browser.close();
