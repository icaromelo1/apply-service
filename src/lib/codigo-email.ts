import { ImapFlow } from "imapflow";
import { config } from "../config.js";

const REMETENTE = /greenhouse-mail\.io|greenhouse\.io|ashbyhq\.com|lever\.co/i;
const ASSUNTO = /security code|verification code|c[óo]digo de (seguran[çc]a|verifica[çc][ãa]o)/i;
const CODIGO = /\b([A-Za-z0-9]{6,10})\b/;

function decodificar(bruto: string): string {
  return bruto
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function linhasVisiveis(fonte: string): string[] {
  const html = fonte.slice(Math.max(0, fonte.indexOf("text/html")));
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function extrairCodigo(fonte: string): string | null {
  const linhas = linhasVisiveis(decodificar(fonte));
  const marcador = linhas.findIndex((l) => /copy and paste this code|c[óo]digo abaixo|this code into/i.test(l));

  if (marcador >= 0) {
    for (const linha of linhas.slice(marcador + 1, marcador + 4)) {
      const achado = linha.match(/^([A-Za-z0-9]{6,10})$/)?.[1];
      if (achado) return achado;
    }
  }

  for (const linha of linhas) {
    if (linha.length > 12) continue;
    const achado = linha.match(CODIGO)?.[1];
    if (achado && /[A-Za-z]/.test(achado) && /[0-9A-Z]/.test(achado)) return achado;
  }
  return null;
}

export async function buscarCodigoVerificacao(desde: Date, empresa?: string): Promise<string | null> {
  const { emailUser, emailPassword, emailHost } = config;
  if (!emailUser || !emailPassword) return null;

  const cliente = new ImapFlow({
    host: emailHost,
    port: 993,
    secure: true,
    auth: { user: emailUser, pass: emailPassword },
    logger: false,
  });

  try {
    await cliente.connect();
    const lock = await cliente.getMailboxLock("INBOX");

    try {
      const candidatos: { data: Date; codigo: string; casaEmpresa: boolean }[] = [];

      for await (const msg of cliente.fetch({ since: desde }, { envelope: true, source: true })) {
        const assunto = msg.envelope?.subject ?? "";
        const remetente = msg.envelope?.from?.[0]?.address ?? "";
        if (!ASSUNTO.test(assunto) && !REMETENTE.test(remetente)) continue;

        const codigo = extrairCodigo(msg.source?.toString("utf8") ?? "");
        if (!codigo) continue;

        candidatos.push({
          data: msg.envelope?.date ?? new Date(0),
          codigo,
          casaEmpresa: empresa ? assunto.toLowerCase().includes(empresa.toLowerCase()) : true,
        });
      }

      if (candidatos.length === 0) return null;

      const daEmpresa = candidatos.filter((c) => c.casaEmpresa);
      const lista = daEmpresa.length > 0 ? daEmpresa : candidatos;
      lista.sort((a, b) => b.data.getTime() - a.data.getTime());
      return lista[0]?.codigo ?? null;
    } finally {
      lock.release();
    }
  } catch {
    return null;
  } finally {
    await cliente.logout().catch(() => {});
  }
}

export function leituraDeEmailDisponivel(): boolean {
  return Boolean(config.emailUser && config.emailPassword);
}
