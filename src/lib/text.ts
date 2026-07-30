export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

export function containsAny(haystack: string, terms: string[]): boolean {
  const normalized = normalizeText(haystack);
  return terms.some((t) => normalized.includes(normalizeText(t)));
}
