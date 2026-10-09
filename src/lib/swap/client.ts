/**
 * Browser side of the swap routes: `/api/swap/*` (quotes and venues on the
 * Solana router) and `/api/solana/rpc` + `/api/solana/ws` (the RPC reads a
 * trade needs, and the confirmation). Building, signing and sending happen on
 * the server (`/api/wallets/{id}/swap`, src/lib/vault/client.ts).
 */
import { withBasePath } from "../basePath";
import {
  SOL_MINT,
  USDC_MINT,
  type ErrorBody,
  type RouterQuote,
  type VenueInfo,
} from "./quote";

export interface QuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  swapMode?: "ExactIn" | "ExactOut";
  slippageBps: number;
  /** venue labels to keep out of the route */
  excludeDexes?: string[];
}

export type QuoteResult =
  | { ok: true; quote: RouterQuote }
  | { ok: false; status: number; body: ErrorBody };

export async function fetchQuote(req: QuoteRequest, signal?: AbortSignal): Promise<QuoteResult> {
  const q = new URLSearchParams({
    inputMint: req.inputMint,
    outputMint: req.outputMint,
    amount: req.amount.toString(),
    slippageBps: String(req.slippageBps),
  });
  if (req.swapMode === "ExactOut") q.set("swapMode", "ExactOut");
  if (req.excludeDexes?.length) q.set("excludeDexes", req.excludeDexes.join(","));
  const r = await fetch(withBasePath(`/api/swap/quote?${q}`), { signal, cache: "no-store" });
  let body: unknown = null;
  try {
    body = await r.json();
  } catch {
    // never let an edge error page surface as a SyntaxError
  }
  if (r.ok && body && typeof body === "object" && "outAmount" in body) {
    return { ok: true, quote: body as RouterQuote };
  }
  return { ok: false, status: r.status, body: (body as ErrorBody) ?? {} };
}

/** Used until `/api/swap/venues` answers (or if it cannot): the servable
 *  venues of the public router on 2026-10-04. */
export const FALLBACK_VENUES: VenueInfo[] = [
  "PumpFun",
  "PumpSwap",
  "Raydium AMM V4",
  "Raydium CPMM",
  "Raydium CLMM",
  "RaydiumLaunchpad",
  "Meteora DAMM V1",
  "Meteora DAMM V2",
  "Meteora DLMM",
  "Meteora DBC",
  "Orca Whirlpool",
  "Heaven",
  "Moonit",
  "SolFi V2",
  "ZeroFi",
  "GoonFi",
].map((dex) => ({ dex }));

export async function fetchVenues(): Promise<VenueInfo[]> {
  const r = await fetch(withBasePath("/api/swap/venues"));
  const j: { data?: VenueInfo[] } = await r.json();
  if (!r.ok || !Array.isArray(j.data) || j.data.length === 0) throw new Error("no venues");
  return j.data;
}

/** One JSON-RPC call through `/api/solana/rpc` (whitelisted methods only). */
export async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(withBasePath("/api/solana/rpc"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-trade-ui": "1" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  let j: { result?: T; error?: { message?: string; data?: { err?: unknown } } | string; reason?: string };
  try {
    j = await r.json();
  } catch {
    throw new Error(`RPC unavailable (${r.status})`);
  }
  if (j.error) {
    if (typeof j.error === "string") throw new Error(j.reason || j.error);
    // A refused send carries the simulation's error in `data.err`
    // ("AccountNotFound", {"InstructionError":[3,{"Custom":…}]}): keep it, so
    // swapErrorText can say what went wrong.
    const err = j.error.data?.err;
    const detail = err == null ? "" : ` (${typeof err === "string" ? err : JSON.stringify(err)})`;
    throw new Error(`${j.error.message || "RPC error"}${detail}`);
  }
  return j.result as T;
}

type SigStatus = { state: "pending" | "confirmed" } | { state: "failed"; err: unknown };

async function signatureStatus(sig: string): Promise<SigStatus> {
  const r = await rpcCall<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>(
    "getSignatureStatuses",
    [[sig], { searchTransactionHistory: false }],
  );
  const v = r?.value?.[0];
  if (!v) return { state: "pending" };
  if (v.err) return { state: "failed", err: v.err };
  return { state: v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized" ? "confirmed" : "pending" };
}

/** An on-chain failure, with the runtime's error kept for swapErrorText. */
const failedOnChain = (err: unknown) => new Error(`Transaction failed on-chain (${JSON.stringify(err)})`);

function solanaWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${withBasePath("/api/solana/ws")}`;
}

/**
 * Wait for `sig` to reach `confirmed`. Push first: `signatureSubscribe` on the
 * RPC's WebSocket (`/api/solana/ws`, served by server.mjs), plus one status
 * read right after subscribing for a transaction that landed before the
 * subscription. Only when no socket can be opened does it fall back to
 * reading the status every 1.5 s. Throws on an on-chain failure or the
 * timeout.
 */
export function confirmSignature(sig: string, timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    let ws: WebSocket | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      try { ws?.close(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error("Confirmation timed out")), timeoutMs);
    const check = () => {
      signatureStatus(sig)
        .then((s) => {
          if (s.state === "failed") finish(failedOnChain(s.err));
          else if (s.state === "confirmed") finish();
        })
        .catch(() => { /* the next push or check decides */ });
    };
    const fallback = () => {
      if (done || poll) return;
      check();
      poll = setInterval(check, 1500);
    };
    try {
      ws = new WebSocket(solanaWsUrl());
    } catch {
      fallback();
      return;
    }
    ws.onopen = () => {
      ws?.send(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "signatureSubscribe",
        params: [sig, { commitment: "confirmed" }],
      }));
    };
    ws.onmessage = (ev) => {
      let m: { id?: number; result?: unknown; error?: unknown; method?: string; params?: { result?: { value?: { err?: unknown } } } };
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.id === 1) {
        if (m.error) fallback();
        else check(); // it may have landed before the subscription
        return;
      }
      if (m.method === "signatureNotification") {
        const err = m.params?.result?.value?.err;
        finish(err ? failedOnChain(err) : undefined);
      }
    };
    ws.onerror = () => fallback();
    ws.onclose = () => fallback();
  });
}

// ── Reads a trade needs ──────────────────────────────────────────────────

const KNOWN_DECIMALS: Record<string, number> = {
  [SOL_MINT]: 9,
  [USDC_MINT]: 6,
  USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB: 6,
};

const decimalsCache = new Map<string, Promise<number>>();

/** A mint's decimals, read from the chain once per page load. */
export function mintDecimals(mint: string): Promise<number> {
  const known = KNOWN_DECIMALS[mint];
  if (known !== undefined) return Promise.resolve(known);
  let p = decimalsCache.get(mint);
  if (!p) {
    p = rpcCall<{ value: { data?: { parsed?: { info?: { decimals?: number } } } } | null }>(
      "getAccountInfo",
      [mint, { encoding: "jsonParsed", commitment: "confirmed" }],
    ).then((r) => {
      const d = r?.value?.data?.parsed?.info?.decimals;
      if (typeof d !== "number") throw new Error("not a token mint");
      return d;
    });
    decimalsCache.set(mint, p);
    p.catch(() => decimalsCache.delete(mint));
  }
  return p;
}

/** What `owner` can sell of `mint`, in raw units, read from the chain (both
 *  token programs: the mint filter finds the accounts of either). The swap
 *  spends from one token account, the associated one, so this is the largest
 *  account's balance, not the sum: a stray second account would make a 100%
 *  sell ask for more than the route can take. */
export async function tokenBalanceRaw(owner: string, mint: string): Promise<bigint> {
  if (mint === SOL_MINT) {
    const r = await rpcCall<{ value: number }>("getBalance", [owner, { commitment: "confirmed" }]);
    return BigInt(r?.value ?? 0);
  }
  const r = await rpcCall<{
    value: { account: { data: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }[];
  }>("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }]);
  let best = 0n;
  for (const a of r?.value ?? []) {
    const amt = a.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (typeof amt === "string" && /^\d+$/.test(amt) && BigInt(amt) > best) best = BigInt(amt);
  }
  return best;
}
