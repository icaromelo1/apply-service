import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CAMINHOS_AGY = [
  process.env.AGY_BIN,
  "/usr/local/bin/agy",
  `${process.env.HOME ?? ""}/.local/bin/agy`,
].filter((c): c is string => Boolean(c));

const AGY_BIN = CAMINHOS_AGY.find((c) => existsSync(c)) ?? CAMINHOS_AGY[0]!;
const AGY_MODEL = process.env.AGY_MODEL ?? "Gemini 3.6 Flash (Low)";
const AGY_CWD = process.env.AGY_CWD ?? "/tmp";
const TIMEOUT_MS = 180_000;

const RUIDO = [
  /^Ripgrep is not available/i,
  /^Loaded cached credentials/i,
  /^\s*⠋|^\s*⠙|^\s*⠹/,
  /^Data collection is/i,
];

export function agyAvailable(): boolean {
  return existsSync(AGY_BIN);
}

function limpar(saida: string): string {
  return saida
    .split("\n")
    .filter((linha) => !RUIDO.some((r) => r.test(linha)))
    .join("\n")
    .trim();
}

export function extrairJson(texto: string): string {
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio === -1 || fim === -1 || fim < inicio) {
    throw new Error(`resposta do agy não contém JSON: ${texto.slice(0, 200)}`);
  }
  return texto.slice(inicio, fim + 1);
}

const TENTATIVAS = 3;
const ESPERA_BASE_MS = 5000;

function ehTransitorio(erro: unknown): boolean {
  const texto = erro instanceof Error ? `${erro.message}` : String(erro);
  return /UNAVAILABLE|503|502|429|RESOURCE_EXHAUSTED|deadline|timeout|ECONNRESET|socket hang up/i.test(texto);
}

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function agyPrompt(system: string, user: string): Promise<string> {
  const prompt = `${system}\n\n---\n\n${user}`;
  let ultimo: unknown;

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      const { stdout } = await execFileAsync(
        AGY_BIN,
        ["-p", prompt, "--model", AGY_MODEL],
        { cwd: AGY_CWD, timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      );

      const limpo = limpar(stdout);
      if (!limpo) throw new Error("agy retornou resposta vazia");
      return limpo;
    } catch (err) {
      ultimo = err;
      if (tentativa === TENTATIVAS || !ehTransitorio(err)) break;
      const espera = ESPERA_BASE_MS * 2 ** (tentativa - 1);
      console.warn(`[agy] falha transitória (tentativa ${tentativa}/${TENTATIVAS}), aguardando ${espera / 1000}s`);
      await dormir(espera);
    }
  }

  throw ultimo instanceof Error ? ultimo : new Error(String(ultimo));
}
