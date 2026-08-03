import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

const VALIDADE_MS = 90 * 60 * 1000;

function caminho(nome: string): string {
  return join(config.paths.dataDir, `${nome}.lock`);
}

export function adquirirTrava(nome: string): boolean {
  const arquivo = caminho(nome);
  mkdirSync(config.paths.dataDir, { recursive: true });

  if (existsSync(arquivo)) {
    const quando = Number(readFileSync(arquivo, "utf8").split("|")[1] ?? 0);
    if (Date.now() - quando < VALIDADE_MS) return false;
  }

  writeFileSync(arquivo, `${process.pid}|${Date.now()}`);
  return true;
}

export function liberarTrava(nome: string): void {
  try {
    rmSync(caminho(nome), { force: true });
  } catch {}
}
