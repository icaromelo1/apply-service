import { ImapFlow } from "imapflow";
import { config } from "../config.js";

const PADRAO_CODIGO = /\b([A-Z0-9]{8})\b/;

function ehCodigoPlausivel(texto: string): boolean {
  return /verification code|c[óo]digo de verifica[çc][ãa]o|confirm you.re a human/i.test(texto);
}

export async function buscarCodigoVerificacao(desde: Date): Promise<string | null> {
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
      const mensagens = cliente.fetch(
        { since: desde },
        { envelope: true, bodyParts: ["TEXT"], source: false },
      );

      const candidatos: { data: Date; codigo: string }[] = [];

      for await (const msg of mensagens) {
        const assunto = msg.envelope?.subject ?? "";
        const corpo = msg.bodyParts?.get("TEXT")?.toString("utf8") ?? "";
        const inteiro = `${assunto}\n${corpo}`;
        if (!ehCodigoPlausivel(inteiro)) continue;

        const achado = corpo.match(PADRAO_CODIGO)?.[1] ?? assunto.match(PADRAO_CODIGO)?.[1];
        if (achado) candidatos.push({ data: msg.envelope?.date ?? new Date(0), codigo: achado });
      }

      if (candidatos.length === 0) return null;
      candidatos.sort((a, b) => b.data.getTime() - a.data.getTime());
      return candidatos[0]?.codigo ?? null;
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
