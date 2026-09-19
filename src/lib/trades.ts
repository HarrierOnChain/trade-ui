import type { Trade } from "../types";

function normalizeTradeTimestamp(timestamp: Trade["timestamp"] | null | undefined): number {
  if (timestamp == null) return 0;
  if (typeof timestamp === "number") return timestamp > 1e12 ? timestamp : timestamp * 1000;

  const numeric = Number(timestamp);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAmount(value: number | null | undefined): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : "";
}

export function tradeIdentityKey(trade: Trade): string {
  return [
    trade.signature || "unknown-signature",
    trade.signer || "unknown-signer",
    trade.tokenMint || "unknown-token",
    trade.transactionType || "unknown-side",
    String(normalizeTradeTimestamp(trade.timestamp)),
    normalizeAmount(trade.tokensAmount),
    normalizeAmount(trade.solAmount),
  ].join(":");
}

export function dedupeTrades(trades: Trade[]): Trade[] {
  const seen = new Set<string>();
  return trades.filter((trade) => {
    const key = tradeIdentityKey(trade);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
