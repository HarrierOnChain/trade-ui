import type { TokenEvent } from "../types";
import type { LivePrice } from "../hooks/useLiveTradePrices";

/**
 * A token is spam/dead when it has no trading activity of any kind — no trades
 * in REST 24h aggregates, no first-hour stats, and no live WS ticks. Fresh
 * tokens stay hidden until at least one trade arrives.
 */
export function isSpamToken(t: TokenEvent, live?: LivePrice): boolean {
  const hasActivity =
    (t.tradeCount ?? 0) > 0 ||
    (t.totalSolVolume ?? 0) > 0 ||
    (t.firstHourTrades ?? 0) > 0 ||
    (t.volume24h ?? 0) > 0 ||
    (t.creatorBuySol ?? 0) > 0 ||
    (live?.tradeCount ?? 0) > 0 ||
    (live?.volumeSol ?? 0) > 0;

  return !hasActivity;
}

/**
 * Effective "volume" score for a token — combines REST totals with live WS
 * delta so the higher-value duplicate wins even before enrichment lands.
 */
function volumeScore(t: TokenEvent, live?: LivePrice): number {
  return (
    (t.totalSolVolume ?? 0) +
    (t.volume24h ?? 0) +
    (t.firstHourVolume ?? 0) +
    (live?.volumeSol ?? 0)
  );
}

/**
 * Dedupe a list of tokens by (normalized) display name. For every name, keep
 * the highest-volume entry; drop the rest. Preserves original ordering of the
 * first occurrence so visually it feels stable.
 */
export function dedupeByName(
  tokens: TokenEvent[],
  liveMap?: Map<string, LivePrice>,
): TokenEvent[] {
  const best = new Map<string, { token: TokenEvent; score: number; index: number }>();
  tokens.forEach((t, i) => {
    const key = normalizeName(t.name, t.symbol, t.mint_address);
    if (!key) { best.set(`__mint:${t.mint_address}`, { token: t, score: -1, index: i }); return; }
    const score = volumeScore(t, liveMap?.get(t.mint_address));
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
