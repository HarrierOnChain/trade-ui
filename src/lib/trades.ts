import type { Trade } from "../types";

function normalizeAmount(value: number | null | undefined): string {
  if (value == null) return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : "";
}

/**
 * Identity of a row on one token's tape: the API's `id`, the same on REST
 * pages, the trades snapshot, live frames and retracts (on EVM one swap log,
 * on Solana one wallet's row of a transaction). A row the UI makes itself has
 * no id and falls back to (signature, wallet).
 */
export function tradeKey(t: Pick<Trade, "id" | "signature" | "signer">): string {
  return t.id || `${t.signature}:${t.signer}`;
}

/**
 * Identity of a row in a list that spans tokens (a wallet's activity): a
 * token-to-token swap is one row per token.
 */
export function tradeKeyAcrossTokens(t: Pick<Trade, "id" | "signature" | "signer" | "tokenMint">): string {
  return `${t.tokenMint}:${tradeKey(t)}`;
}

/** Native volume of a row, or null when the API has none (never a made-up 0). */
export function tradeNative(t: Pick<Trade, "solAmount">): number | null {
  const v = t.solAmount;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The row's key: every leg of a transaction has its own id. */
export const tradeLegKey = tradeKey;

/** tradeLegKey for a list that spans tokens (a wallet's activity). */
export const tradeLegKeyAcrossTokens = tradeKeyAcrossTokens;

/**
 * Merges an API answer (a REST page or a WS snapshot) into a list: a row the
 * list holds is replaced by the answer's copy (its tags and amounts are the
 * newest), the others are added. Order is the caller's.
 */
export function mergeTradeBatch(existing: Trade[], batch: Trade[]): Trade[] {
  if (!batch.length) return existing;
  const incoming = new Map<string, Trade>();
  for (const t of batch) incoming.set(tradeKey(t), t);
  const out: Trade[] = [];
  for (const t of existing) {
    const key = tradeKey(t);
    const copy = incoming.get(key);
    if (copy) {
      out.push(copy);
      incoming.delete(key);
    } else {
      out.push(t);
    }
  }
  for (const t of incoming.values()) out.push(t);
  return out;
}

/**
 * Puts one live frame at the head of a list, or merges it into the row of
 * the same id (the frame's defined fields win). Returns `prev` itself when
 * nothing changes.
 */
export function addLiveTrade(prev: Trade[], frame: Trade): Trade[] {
  const key = tradeKey(frame);
  const i = prev.findIndex((t) => tradeKey(t) === key);
  if (i < 0) return [{ ...frame, live: true }, ...prev];
  const held = prev[i];
  const row: Trade = { ...held };
  let changed = false;
  const target = row as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(frame)) {
    if (v === undefined || k === "live") continue;
    if (JSON.stringify(target[k]) === JSON.stringify(v)) continue;
    target[k] = v;
    changed = true;
  }
  if (!changed) return prev;
  const out = prev.slice();
  out[i] = row;
  return out;
}

/**
 * Replaces the tags of the rows a `tags` frame names (by id): the API learnt
 * their makers' tags after it sent them.
 */
export function applyTradeTags(prev: Trade[], rows: { id: string; tags: string[] }[]): Trade[] {
  if (!rows.length) return prev;
  const byId = new Map(rows.map((r) => [r.id, r.tags]));
  let changed = false;
  const out = prev.map((t) => {
    const tags = t.id ? byId.get(t.id) : undefined;
    if (!tags) return t;
    changed = true;
    return {
      ...t,
      tags,
      isBundle: tags.includes("bundle"),
      isSniper: tags.includes("sniper"),
      isProTrader: tags.includes("pro"),
    };
  });
  return changed ? out : prev;
}

/**
 * Drops the rows of a Solana slot whose fork was lost (the API's `retract`
 * frame names them by id). Those rows never executed; the copy from the slot
 * where the transaction landed, if any, comes later as a new trade.
 */
export function dropRetracted(prev: Trade[], gone: { id: string }[]): Trade[] {
  if (!gone.length) return prev;
  const ids = new Set(gone.map((g) => g.id));
  const next = prev.filter((t) => !t.id || !ids.has(t.id));
  return next.length === prev.length ? prev : next;
}

/**
 * Merges lists for display (the tape with wallet histories for chart marks):
 * a row an earlier list holds (same id) is taken from that list only.
 */
export function mergeTradeLists(...lists: Trade[][]): Trade[] {
  const out: Trade[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const t of list) {
      const key = tradeKey(t);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

/** Appends one page to a wallet's list, up to `cap` rows, each row once. */
export function appendTradePage(prev: Trade[], page: Trade[], { cap }: { cap: number }): Trade[] {
  const seen = new Set(prev.map(tradeKeyAcrossTokens));
  const out = prev.slice();
  for (const t of page) {
    const key = tradeKeyAcrossTokens(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.slice(0, cap);
}

export function tradeIdentityKey(trade: Trade): string {
  if (trade.id) return `${trade.tokenMint}:${trade.id}`;
  return [
    trade.signature || "unknown-signature",
    trade.signer || "unknown-signer",
    trade.tokenMint || "unknown-token",
    trade.transactionType || "unknown-side",
    String(Number(trade.timestamp) || 0),
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
