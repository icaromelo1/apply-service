import { mkdirSync } from "node:fs";
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
  const path = join(config.paths.screenshotsDir, `${applicationId}-${Date.now()}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

export async function hasCaptcha(page: Page): Promise<boolean> {
  const captcha = page.locator(
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], div.g-recaptcha, div.h-captcha',
  );
  return (await captcha.count()) > 0;
}

export interface ApplyOutcome {
  status: "applied" | "needs_review" | "failed";
  note?: string;
  answers?: string;
}
