/**
 * The Solana router's quote (Jupiter-shaped: amounts as decimal strings, a
 * `routePlan`) and the view the UI renders from it. Pure: the tests import it
 * directly (`src/lib/swap/swap.test.ts`), so only type imports here.
 */

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The router's `SwapInfo` (one hop). */
export interface SwapInfo {
  ammKey: string;
  label: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  walkSteps?: number;
}

export interface RoutePlanStep {
  swapInfo: SwapInfo;
  percent?: number;
  bps?: number;
}

/** The router's `GET /quote` answer, kept verbatim: it goes back unchanged as
 *  `quoteResponse` when the swap is built. */
export interface RouterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps: number;
  priceImpactPct: string;
  routePlan: RoutePlanStep[];
  contextSlot?: number;
  timeTaken?: number;
  quoteId?: string;
  [extra: string]: unknown;
}

/** Error envelope of the router and of the `/api/swap/*` routes. */
export interface ErrorBody {
  error?: string;
  reason?: string;
  reasons?: readonly string[];
}

/** A routable venue: the router's `dex` label, also what `excludeDexes` takes. */
export interface VenueInfo {
  dex: string;
  /** the router's price oracle: `red` venues are held out of every route */
  verdict?: string | null;
}

/** The unsigned swap transaction for one wallet, built from exactly one quote
 *  (`POST /api/swap/build` → router `/swap-instructions`, serialized). */
export interface SwapBuild {
  /** base64, unsigned v1 transaction as the router built it */
  transaction: string;
  /** base64, the same instructions as a v0 transaction; null when not asked or it does not fit */
  transactionV0: string | null;
  v0Unavailable: string | null;
  lastValidBlockHeight: number | null;
  quoteId: string | null;
  inAmount: string | null;
  outAmount: string | null;
  otherAmountThreshold: string | null;
}

export interface RouteHop {
  dex: string;
  pool: string;
  inputMint: string;
  outputMint: string;
  inAmount: bigint;
  outAmount: bigint;
}

/** One route of the quote. A split quote has two, one after the other. */
export interface RouteLeg {
  /** share of the input in basis points (10000 for a single route) */
  bps: number;
  inAmount: bigint;
  outAmount: bigint;
  hops: RouteHop[];
}

export interface QuoteView {
  /** the router's answer, verbatim: what the swap build pins */
  raw: RouterQuote;
  inputMint: string;
  outputMint: string;
  swapMode: "ExactIn" | "ExactOut";
  inAmount: bigint;
  outAmount: bigint;
  /** ExactIn: the least that arrives; ExactOut: the most that is spent */
  threshold: bigint;
  priceImpactBps: number;
  legs: RouteLeg[];
  slot: number;
  /** seconds the router spent */
  timeTaken: number;
  quoteId: string | null;
}

const big = (s: string | undefined): bigint => {
  try {
    return BigInt(s ?? "0");
  } catch {
    return 0n;
  }
};

/** Cut `routePlan` into routes: a route ends at the first step whose output is
 *  the quote's output mint (the router's documented rule for splits). */
export function splitLegs(q: RouterQuote): RouteLeg[] {
  const legs: RouteLeg[] = [];
  let cur: RouteLeg | null = null;
  for (const step of q.routePlan ?? []) {
    const s = step.swapInfo;
    if (!s) continue;
    if (!cur) {
      cur = {
        bps: step.bps ?? (step.percent ?? 100) * 100,
        inAmount: big(s.inAmount),
        outAmount: 0n,
        hops: [],
      };
    }
    cur.hops.push({
      dex: s.label,
      pool: s.ammKey,
      inputMint: s.inputMint,
      outputMint: s.outputMint,
      inAmount: big(s.inAmount),
      outAmount: big(s.outAmount),
    });
    if (s.outputMint === q.outputMint) {
      cur.outAmount = big(s.outAmount);
      legs.push(cur);
      cur = null;
    }
  }
  if (cur) {
    // A plan that never reaches the output mint: show what there is.
    cur.outAmount = cur.hops[cur.hops.length - 1]?.outAmount ?? 0n;
    legs.push(cur);
  }
  return legs;
}

export function toQuoteView(q: RouterQuote): QuoteView {
  const impact = Number(q.priceImpactPct);
  return {
    raw: q,
    inputMint: q.inputMint,
    outputMint: q.outputMint,
    swapMode: q.swapMode === "ExactOut" ? "ExactOut" : "ExactIn",
    inAmount: big(q.inAmount),
    outAmount: big(q.outAmount),
    threshold: big(q.otherAmountThreshold),
    priceImpactBps: Number.isFinite(impact) ? Math.round(impact * 10_000) : 0,
    legs: splitLegs(q),
    slot: Number(q.contextSlot) || 0,
    timeTaken: Number(q.timeTaken) || 0,
    quoteId: typeof q.quoteId === "string" ? q.quoteId : null,
  };
}

/** "Meteora DLMM" or "PumpSwap → Raydium CLMM". */
export function legLabel(leg: RouteLeg): string {
  return leg.hops.map((h) => h.dex).join(" → ") || "—";
}

/** The "via" line: the split composition ("40% SolFi V2 + 60% Raydium CLMM")
 *  or the single route's venues. */
export function viaLabel(v: QuoteView): string {
  if (v.legs.length >= 2) {
    return v.legs.map((l) => `${Math.round(l.bps / 100)}% ${legLabel(l)}`).join(" + ");
  }
  return v.legs[0] ? legLabel(v.legs[0]) : "—";
}

export type QuoteFailure =
  /** no route for this pair under these filters: render "No route" */
  | { kind: "noroute"; message: string }
  /** the transport or the router's state, not the pair: keep the last quote */
  | { kind: "transient"; message: string }
  /** the request itself is wrong */
  | { kind: "bad"; message: string };

const DECLINE_TEXT: Record<string, string> = {
  no_route: "No route",
  low_liquidity: "Only dust pools",
  cold_unresolved: "Unknown token",
  transfer_guard: "Token transfers are restricted",
  unbuildable: "No buildable route",
};

/** Classify a failed quote (router status + `{error, reason}`). */
export function classifyQuoteError(status: number, body: ErrorBody): QuoteFailure {
  const reason = body.reason ?? "";
  if (status === 404) return { kind: "noroute", message: DECLINE_TEXT[reason] ?? "No route" };
  if (status === 422) {
    // `stale`: a pool on the route is being re-read, retry in a moment.
    if (reason === "stale") return { kind: "transient", message: "Pools refreshing, retrying…" };
    return {
      kind: "noroute",
      message: DECLINE_TEXT[reason] ?? `No route (${reason || "declined"})`,
    };
  }
  if (status === 400) {
    if (reason === "zero_amount") return { kind: "bad", message: "Amount too small" };
    return { kind: "bad", message: reason || body.error || "Bad request" };
  }
  if (status === 429) return { kind: "transient", message: "Rate limited, slowing down…" };
  if (status === 503) return { kind: "transient", message: "Router warming up, retrying…" };
  return { kind: "transient", message: "Router unreachable, retrying…" };
}

/** A failed build, in words the trader can act on. */
export function describeBuildError(status: number, j: ErrorBody): string {
  const why = j.reason || j.reasons?.join("; ") || j.error || `HTTP ${status}`;
  if (status === 409) return `The route changed since the quote (${why}): try again`;
  if (status === 503) return `Router not ready (${why}): try again in a moment`;
  if (j.reason === "dark_trader") return "SolFi V2 would charge this wallet extra: exclude it and retry";
  return `Could not build the swap: ${why}`;
}

// The swap program's own errors (`ProgramError::Custom(0x5357_0000 + n)`,
// swapwire `SwapError`): the floor or cap the quote set was missed, or the
// quote's deadline passed before the transaction landed.
const CLAIM_BELOW_FLOOR = 0x5357_0000 + 14;
const CLAIM_ABOVE_CAP = 0x5357_0000 + 15;
const DEADLINE_EXPIRED = 0x5357_0000 + 6;

/** What went wrong, in words the trader can act on. */
export function swapErrorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const custom = /"Custom":(\d+)/.exec(raw);
  const code = custom ? Number(custom[1]) : null;
  if (/reject|denied|cancel/i.test(raw)) return "Rejected in wallet";
  if (code === CLAIM_BELOW_FLOOR || code === CLAIM_ABOVE_CAP) return "Price moved past your slippage: try again or raise it";
  if (code === DEADLINE_EXPIRED) return "The quote expired before the transaction landed: try again";
  if (/AccountNotFound|no record of a prior credit/i.test(raw)) return "This wallet has no SOL yet: fund it to trade";
  if (/InsufficientFunds|insufficient (funds|lamports)|"Custom":1\}/i.test(raw)) return "Not enough balance for this trade and its fees";
  if (/BlockhashNotFound|block height exceeded/i.test(raw)) return "The transaction expired before it landed: try again";
  return raw;
}

/** Raw base units → UI number (lossy only beyond ~15 significant digits). */
export function toUi(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

/** UI decimal string → raw base units, exact (no float rounding). Null when the
 *  text is not a positive amount. Digits past `decimals` are truncated. */
export function toRaw(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const [int, frac = ""] = t.split(".");
  const raw = BigInt((int || "0") + frac.slice(0, decimals).padEnd(decimals, "0"));
  return raw > 0n ? raw : null;
}

/** A JS number (a preset, a stored amount) → raw units, through its decimal
 *  text so 0.1 SOL is exactly 100,000,000 lamports. */
export function numberToRaw(n: number, decimals: number): bigint | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return toRaw(n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 }), decimals);
}
