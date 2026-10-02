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

// EVM hashes and addresses come back checksummed from one source and
// lowercase from another; base58 is case-sensitive and stays as is.
function canon(v: string | null | undefined): string {
  if (!v) return "";
  return v.startsWith("0x") ? v.toLowerCase() : v;
}

/**
 * Identity of a row on one token's tape: one row per (signature, wallet).
 * Co-signers of one transaction are two rows and must both survive a merge,
 * so the signature alone is not an identity. Rows without a signature fall
 * back to (wallet, time).
 */
export function tradeKey(t: Pick<Trade, "signature" | "signer" | "timestamp">): string {
  const sig = canon(t.signature);
  const wallet = canon(t.signer);
  return sig ? `${sig}:${wallet}` : `:${wallet}:${normalizeTradeTimestamp(t.timestamp)}`;
}

/**
 * Identity of a row in a list that spans tokens (a wallet's activity): a
 * token-to-token swap is one row per token under the same (signature, wallet).
 */
export function tradeKeyAcrossTokens(t: Pick<Trade, "signature" | "signer" | "timestamp" | "tokenMint">): string {
  return `${tradeKey(t)}:${canon(t.tokenMint)}`;
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
