import { createHash } from "node:crypto";

function normalizeForId(s: string): string {
  const stripped = s.normalize("NFD").replace(/\p{M}/gu, "");
  let out = "";
  for (const r of stripped.toLowerCase()) {
    out += /[\p{L}\p{N}]/u.test(r) ? r : " ";
  }
  return out.split(/\s+/).filter(Boolean).join(" ");
}

function normalizeUrl(raw: string): string {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

export function stableId(title: string, company: string, location: string, url: string): string {
  const t = normalizeForId(title);
  const c = normalizeForId(company);
  const l = normalizeForId(location);

  let key: string;
  if (t && c) {
    key = `${t}|${c}|${l || "sem-local"}`;
  } else {
    const u = normalizeUrl(url);
    if (!u) return "";
    key = u;
  }

  return createHash("sha256").update(key).digest("hex").slice(0, 24);
}
