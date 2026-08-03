import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { config } from "../config.js";

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  browser ??= await chromium.launch({ headless: true });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

export async function saveScreenshot(page: Page, applicationId: number): Promise<string> {
  mkdirSync(config.paths.screenshotsDir, { recursive: true });
  const base = join(config.paths.screenshotsDir, `${applicationId}-${Date.now()}`);
  await page.screenshot({ path: `${base}.png`, fullPage: true });
  await page.content().then((html) => writeFileSync(`${base}.html`, html)).catch(() => {});
  return `${base}.png`;
}

export async function hasCaptcha(page: Page): Promise<boolean> {
  const captcha = page.locator(
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], div.g-recaptcha, div.h-captcha',
  );

  const total = Math.min(await captcha.count().catch(() => 0), 6);

  for (let i = 0; i < total; i++) {
    const elemento = captcha.nth(i);
    if (!(await elemento.isVisible().catch(() => false))) continue;

    const caixa = await elemento.boundingBox().catch(() => null);
    if (!caixa) continue;

    if (caixa.width >= 240 && caixa.height >= 60) return true;
  }

  const desafio = page.locator(
    'text=/verify you are human|sou humano|n[ãa]o sou um rob[ôo]|complete the security check/i',
  );
  return (await desafio.count().catch(() => 0)) > 0;
}

export interface ApplyOutcome {
  status: "applied" | "needs_review" | "failed" | "skipped";
  aderencia?: number;
  cvPath?: string;
  note?: string;
  answers?: string;
  virarDigest?: boolean;
}
