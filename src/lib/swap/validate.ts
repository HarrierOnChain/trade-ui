/**
 * What the `/api/swap/*` and `/api/solana/rpc` routes accept and forward. Pure,
 * so the tests exercise it directly: anything the browser sends outside these
 * whitelists is dropped, and fee wallets, tips and recipients never reach the
 * router from here.
 */

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Venue labels as `GET /venues` spells them ("Raydium AMM V4", "SolFi V2"). */
const DEX_RE = /^[A-Za-z0-9 ._-]{1,40}$/;
const U64_MAX = (1n << 64n) - 1n;

/** Priority fee a trader may set by hand, in lamports (0.1 SOL). */
export const PRIORITY_FEE_MAX_LAMPORTS = 100_000_000;

/**
 * The quote parameters forwarded to the router's `GET /quote`, in a fixed
 * order. Returns `{ query }` or `{ error }`.
 */
export function quoteQuery(
  sp: URLSearchParams,
  { allowSplit = false }: { allowSplit?: boolean } = {},
): { query: string; error?: undefined } | { query?: undefined; error: string } {
  const inputMint = sp.get("inputMint") || "";
  const outputMint = sp.get("outputMint") || "";
  const amount = sp.get("amount") || "";
  if (!MINT_RE.test(inputMint) || !MINT_RE.test(outputMint)) return { error: "bad mint" };
  if (inputMint === outputMint) return { error: "input and output are the same token" };
  if (!/^[1-9][0-9]{0,19}$/.test(amount) || BigInt(amount) > U64_MAX) return { error: "bad amount" };
  const q = new URLSearchParams({ inputMint, outputMint, amount });
  const mode = sp.get("swapMode");
  if (mode != null && mode !== "") {
    if (mode !== "ExactIn" && mode !== "ExactOut") return { error: "bad swapMode" };
    q.set("swapMode", mode);
  }
  const slip = sp.get("slippageBps");
  if (slip != null && slip !== "") {
    if (!/^[0-9]{1,5}$/.test(slip) || Number(slip) > 10_000) return { error: "bad slippageBps" };
    q.set("slippageBps", String(Number(slip)));
  }
  const ex = sp.get("excludeDexes");
  if (ex) {
    const list = ex
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length > 40 || !list.every((d) => DEX_RE.test(d))) return { error: "bad excludeDexes" };
    if (list.length) q.set("excludeDexes", list.join(","));
  }
  const hops = sp.get("maxHops");
  if (hops != null && hops !== "") {
    if (!/^[1-4]$/.test(hops)) return { error: "bad maxHops" };
    q.set("maxHops", hops);
  }
  // Keys the router must leave free out of the 64 a transaction can name: the
  // UI asks for it when the wallet can only sign v0 (routes that fit 1,232 bytes).
  const reserve = sp.get("reserveKeys");
  if (reserve != null && reserve !== "") {
    if (!/^[0-9]{1,2}$/.test(reserve) || Number(reserve) > 63) return { error: "bad reserveKeys" };
    q.set("reserveKeys", String(Number(reserve)));
  }
  if (allowSplit) q.set("allowSplit", "true");
  return { query: q.toString() };
}

export interface SwapBodyOut {
  userPublicKey: string;
  quoteResponse: Record<string, unknown>;
  serialize: true;
  wrapAndUnwrapSol: true;
  prioritizationFeeLamports: number | { priorityLevelWithMaxLamports: { maxLamports: number } };
}

/**
 * The body sent to the router's `POST /swap-instructions`: the wallet and the
 * quote it was shown, built as quoted (no re-quote: the floor the UI showed is
 * the floor the program enforces). The priority fee is the trader's own total
 * when given, else the router's estimate capped at `priorityMaxLamports`.
 * Returns `{ body, v0 }` or `{ error }`.
 */
export function swapBody(
  input: unknown,
  { priorityMaxLamports }: { priorityMaxLamports: number },
): { body: SwapBodyOut; v0: boolean; error?: undefined } | { body?: undefined; error: string } {
  if (!input || typeof input !== "object") return { error: "bad request body" };
  const i = input as Record<string, unknown>;
  const wallet = String(i.wallet || "");
  if (!MINT_RE.test(wallet)) return { error: "bad wallet" };
  const q = i.quote as Record<string, unknown> | undefined;
  if (!q || typeof q !== "object" || Array.isArray(q)) return { error: "bad quote" };
  for (const k of ["inputMint", "outputMint"]) {
    if (typeof q[k] !== "string" || !MINT_RE.test(q[k] as string)) return { error: "bad quote" };
  }
  for (const k of ["inAmount", "outAmount", "otherAmountThreshold"]) {
    if (typeof q[k] !== "string" || !/^[0-9]{1,20}$/.test(q[k] as string)) return { error: "bad quote" };
  }
  if (!Array.isArray(q.routePlan) || q.routePlan.length < 1 || q.routePlan.length > 16) {
    return { error: "bad quote" };
  }
  let prioritizationFeeLamports: SwapBodyOut["prioritizationFeeLamports"] = {
    priorityLevelWithMaxLamports: { maxLamports: priorityMaxLamports },
  };
  const fee = i.priorityFeeLamports;
  if (fee != null) {
    if (typeof fee !== "number" || !Number.isInteger(fee) || fee < 0 || fee > PRIORITY_FEE_MAX_LAMPORTS) {
      return { error: "bad priorityFeeLamports" };
    }
    prioritizationFeeLamports = fee;
  }
  return {
    body: {
      userPublicKey: wallet,
      quoteResponse: q,
      serialize: true,
      wrapAndUnwrapSol: true,
      prioritizationFeeLamports,
    },
    v0: i.v0 === true,
  };
}

/** JSON-RPC methods `/api/solana/rpc` forwards: sending a signed transaction,
 *  confirming it, and the reads a sell needs (exact token balances, decimals). */
export const RPC_METHODS = new Set([
  "sendTransaction",
  "getSignatureStatuses",
  "getBalance",
  "getTokenAccountsByOwner",
  "getAccountInfo",
]);

/** A single JSON-RPC request whose method is whitelisted. */
export function rpcRequest(input: unknown): { method: string; params: unknown[]; error?: undefined } | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "bad request body" };
  const i = input as Record<string, unknown>;
  if (typeof i.method !== "string" || !RPC_METHODS.has(i.method)) return { error: "method not allowed" };
  if (i.params != null && !Array.isArray(i.params)) return { error: "bad params" };
  return { method: i.method, params: (i.params as unknown[]) ?? [] };
}
