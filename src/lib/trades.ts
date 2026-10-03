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
  if (value == null) return "";
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

/** Native volume of a row, or null when the API has none (never a made-up 0). */
export function tradeNative(t: Pick<Trade, "solAmount">): number | null {
  const v = t.solAmount;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

type LegFields = Pick<Trade, "signature" | "signer" | "timestamp" | "transactionType" | "tokensAmount" | "solAmount">;

/**
 * Identity of a row inside one API answer or one live stream. On Solana it is
 * tradeKey: a wallet has one net row per transaction. On EVM the API serves one
 * row per swap log, so a wallet can have several rows in one transaction (a
 * route split across pools, a multi-hop through the token); side and amounts
 * tell them apart. Not a cross-source identity: two sources may round the same
 * log's amounts differently.
 */
export function tradeLegKey(t: LegFields): string {
  const key = tradeKey(t);
  if (!t.signature?.startsWith("0x")) return key;
  return `${key}:${t.transactionType}:${normalizeAmount(t.tokensAmount)}:${normalizeAmount(t.solAmount)}`;
}

/** tradeLegKey for a list that spans tokens (a wallet's activity). */
export function tradeLegKeyAcrossTokens(t: LegFields & Pick<Trade, "tokenMint">): string {
  return `${tradeLegKey(t)}:${canon(t.tokenMint)}`;
}

// Tags and flags only accrue: a later copy of a row (a snapshot sent after the
// API learnt a maker's tags, a frame with late flags) adds what it knows.
function withFlagsOf(row: Trade, other: Trade): Trade {
  const have = row.tags ?? [];
  const extra = (other.tags ?? []).filter((t) => !have.includes(t));
  const bundle = !row.isBundle && !!other.isBundle;
  const sniper = !row.isSniper && !!other.isSniper;
  const pro = !row.isProTrader && !!other.isProTrader;
  if (!extra.length && !bundle && !sniper && !pro) return row;
  return {
    ...row,
    tags: extra.length ? [...have, ...extra] : row.tags,
    isBundle: row.isBundle || bundle,
    isSniper: row.isSniper || sniper,
    isProTrader: row.isProTrader || pro,
  };
}

/**
 * Merges an API answer (a REST page or a WS snapshot) into a list. The answer
 * is the authority for every transaction it names, as the API's own snapshot
 * merge is: the list's rows for those signatures are replaced, not matched
 * wallet by wallet, because two sources can name different wallets for one
 * swap (GMGN's maker is the fee payer, the firehose's signer the owner whose
 * balance moved, on ~3.6% of swaps). Rows of one answer are never collapsed
 * beyond exact duplicates: the API already told them apart (co-signers, EVM
 * legs). Order is the caller's.
 */
export function mergeTradeBatch(existing: Trade[], batch: Trade[]): Trade[] {
  if (!batch.length) return existing;
  const sigs = new Set<string>();
  for (const t of batch) {
    const sig = canon(t.signature);
    if (sig) sigs.add(sig);
  }
  const replaced = new Map<string, Trade>();
  const out: Trade[] = [];
  for (const t of existing) {
    const sig = canon(t.signature);
    if (!sig || !sigs.has(sig)) {
      out.push(t);
      continue;
    }
    const key = tradeKey(t);
    const prev = replaced.get(key);
    replaced.set(key, prev ? withFlagsOf(prev, t) : t);
  }
  const seen = new Set(out.map(tradeLegKey));
  for (const t of batch) {
    const leg = tradeLegKey(t);
    if (seen.has(leg)) continue;
    seen.add(leg);
    const old = replaced.get(tradeKey(t));
    out.push(old ? withFlagsOf(t, old) : t);
  }
  return out;
}

/**
 * Puts one live frame at the head of a list. A frame for a transaction that
 * an API answer in the list holds is not added, whatever wallet it names (see
 * mergeTradeBatch); its tags and flags still reach the matching row. Against
 * rows from other live frames, a frame is a duplicate only when it is the
 * same leg. Returns `prev` itself when nothing changes.
 */
export function addLiveTrade(prev: Trade[], frame: Trade): Trade[] {
  const sig = canon(frame.signature);
  const key = tradeKey(frame);
  const leg = tradeLegKey(frame);
  let held = false;
  let target = -1;
  for (let i = 0; i < prev.length; i++) {
    const t = prev[i];
    if (sig ? canon(t.signature) !== sig : tradeKey(t) !== key) continue;
    if (t.live || !sig) {
      if (tradeLegKey(t) !== leg) continue;
      held = true;
      target = i;
      break;
    }
    held = true;
    if (tradeKey(t) === key && (target < 0 || tradeLegKey(t) === leg)) target = i;
  }
  if (!held) return [{ ...frame, live: true }, ...prev];
  if (target < 0) return prev;
  const row = withFlagsOf(prev[target], frame);
  if (row === prev[target]) return prev;
  const out = prev.slice();
  out[target] = row;
  return out;
}

/**
 * Drops the rows of a Solana slot whose fork was lost (the API's `retract`
 * frame names them by signature and wallet; no wallet drops every row of the
 * signature). Those rows never executed; the copy from the slot where the
 * transaction landed, if any, comes later as a new trade with its own amounts.
 */
export function dropRetracted(prev: Trade[], gone: { signature: string; wallet?: string }[]): Trade[] {
  if (!gone.length) return prev;
  const next = prev.filter((t) => !gone.some((g) =>
    canon(t.signature) === canon(g.signature) && (!g.wallet || canon(t.signer) === canon(g.wallet))));
  return next.length === prev.length ? prev : next;
}

/**
 * Merges lists for display (the tape with demo fills; the tape with wallet
 * histories for chart marks). Each list keeps its rows, which its source told
 * apart; a row an earlier list holds (same signature and wallet) is taken from
 * that list only. Leg keys of the result are unique.
 */
export function mergeTradeLists(...lists: Trade[][]): Trade[] {
  const out: Trade[] = [];
  const before = new Set<string>();
  for (const list of lists) {
    const keys = new Set<string>();
    const legs = new Set<string>();
    for (const t of list) {
      const key = tradeKey(t);
      if (before.has(key)) continue;
      const leg = tradeLegKey(t);
      if (legs.has(leg)) continue;
      legs.add(leg);
      keys.add(key);
      out.push(t);
    }
    for (const k of keys) before.add(k);
  }
  return out;
}

/**
 * Appends one page to a wallet's list, up to `cap` rows. `autoMore` says
 * whether the page added enough rows for the list to keep loading on scroll:
 * the wallet route filters an activity feed down to swaps, so a page can bring
 * 0-3 rows with a cursor, leave the scroll sentinel in view and, paging on,
 * walk the upstream one call after another.
 */
export function appendTradePage(
  prev: Trade[],
  page: Trade[],
  { cap, limit }: { cap: number; limit: number },
): { rows: Trade[]; autoMore: boolean } {
  const seen = new Set(prev.map(tradeLegKeyAcrossTokens));
  const out = prev.slice();
  for (const t of page) {
    const key = tradeLegKeyAcrossTokens(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  const added = out.length - prev.length;
  return { rows: out.slice(0, cap), autoMore: added >= Math.ceil(limit / 2) };
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

