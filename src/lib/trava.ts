import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

const VALIDADE_MS = 90 * 60 * 1000;

function caminho(nome: string): string {
  return join(config.paths.dataDir, `${nome}.lock`);
}

function criarExclusivo(arquivo: string): boolean {
  try {
    const fd = openSync(arquivo, "wx");
    writeSync(fd, `${process.pid}|${Date.now()}`);
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

export function adquirirTrava(nome: string): boolean {
  const arquivo = caminho(nome);
  mkdirSync(config.paths.dataDir, { recursive: true });

  if (criarExclusivo(arquivo)) return true;

  if (!existsSync(arquivo)) return criarExclusivo(arquivo);

  const quando = Number(readFileSync(arquivo, "utf8").split("|")[1] ?? 0);
  const idadeMin = Math.round((Date.now() - quando) / 60000);

  if (Date.now() - quando < VALIDADE_MS) {
    console.error(`[trava] ${nome} tomada há ${idadeMin} min (expira em ${VALIDADE_MS / 60000} min)`);
    return false;
  }

  console.warn(`[trava] ${nome} estava órfã há ${idadeMin} min — assumindo`);
  rmSync(arquivo, { force: true });
  return criarExclusivo(arquivo);
}

export function liberarTrava(nome: string): void {
  try {
    rmSync(caminho(nome), { force: true });
  } catch {}
}
