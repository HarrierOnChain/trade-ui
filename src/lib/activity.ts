import type { TokenEvent } from "../types";

/** A token's 24h volume (native, else USD): the higher-volume duplicate wins. */
function volumeScore(t: TokenEvent): number {
  return (t.totalSolVolume ?? 0) + (t.volume24h ?? 0);
}

/**
 * Dedupe a list of tokens by (normalized) display name. For every name, keep
 * the highest-volume entry; drop the rest. Preserves original ordering of the
 * first occurrence so visually it feels stable.
 */
export function dedupeByName(tokens: TokenEvent[]): TokenEvent[] {
  const best = new Map<string, { token: TokenEvent; score: number; index: number }>();
  tokens.forEach((t, i) => {
    const key = normalizeName(t.name, t.symbol, t.mint_address);
    if (!key) { best.set(`__mint:${t.mint_address}`, { token: t, score: -1, index: i }); return; }
    const score = volumeScore(t);
    const cur = best.get(key);
    if (!cur || score > cur.score) {
      best.set(key, { token: t, score, index: cur?.index ?? i });
    }
  });
  // Sort by original index so the feed order is preserved.
  return [...best.values()]
    .sort((a, b) => a.index - b.index)
    .map((v) => v.token);
}

function normalizeName(name?: string, symbol?: string, mint?: string): string {
  const base = (name || symbol || "").trim().toLowerCase();
  // Collapse whitespace & strip common punctuation so trivial variants collapse
  const cleaned = base.replace(/[\s._\-]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();
  if (!cleaned) return `__mint:${mint ?? ""}`;
  return cleaned;
}
