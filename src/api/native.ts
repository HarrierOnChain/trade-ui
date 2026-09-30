import { getActiveChain, nativePriceKey, type ChainId } from "../lib/chains";
import { evmapiGet } from "./evmapi";

/**
 * SOL / ETH / BNB in USD. The UI keeps its internal prices in the chain's
 * native coin, so every USD field from the API is divided by these.
 *
 * Live: the WebSocket's `prices` channel pushes every change here
 * (`setNativePrices`). REST `/v1/prices` only primes the store before the
 * socket's snapshot lands, or when no socket is up.
 */
export type NativeKey = "sol" | "eth" | "bnb";
export type NativePrices = Partial<Record<NativeKey, { usd: number; updatedAt?: number } | null>>;

let prices: NativePrices = {};
let receivedAt = 0;
let inflight: Promise<NativePrices> | null = null;
const listeners = new Set<(p: NativePrices) => void>();

/** How long a REST read stays good while nothing is pushing. */
const REST_TTL_MS = 15_000;

function valid(p: unknown): p is { usd: number; updatedAt?: number } {
  return Boolean(p) && typeof (p as { usd?: unknown }).usd === "number" && (p as { usd: number }).usd > 0;
}

/** Merge a `NativePrices` object (REST data, WS snapshot or update). */
export function setNativePrices(next: unknown): void {
  if (!next || typeof next !== "object") return;
  const src = next as Record<string, unknown>;
  let changed = false;
  const merged: NativePrices = { ...prices };
  for (const k of ["sol", "eth", "bnb"] as const) {
    const p = src[k];
    if (!valid(p)) continue;
    if (merged[k]?.usd !== p.usd) changed = true;
    merged[k] = { usd: p.usd, updatedAt: p.updatedAt };
  }
  prices = merged;
  receivedAt = Date.now();
  if (changed) listeners.forEach((cb) => { try { cb(prices); } catch { /* ignore */ } });
}

/** Latest known price, or 0 when none has arrived yet. */
export function nativeUsdSync(id: ChainId | string = getActiveChain()): number {
  const key = nativePriceKey(id as ChainId);
  return prices[key]?.usd ?? 0;
}

export function onNativePrices(cb: (p: NativePrices) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export async function fetchNativePrices(): Promise<NativePrices> {
  if (receivedAt && Date.now() - receivedAt < REST_TTL_MS && Object.keys(prices).length) return prices;
  if (inflight) return inflight;
  inflight = evmapiGet<NativePrices>("/prices")
    .then(({ data }) => {
      setNativePrices(data);
      return prices;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export async function nativeUsd(id: ChainId | string = getActiveChain()): Promise<number> {
  const now = nativeUsdSync(id);
  if (now > 0 && Date.now() - receivedAt < REST_TTL_MS) return now;
  await fetchNativePrices().catch(() => prices);
  return nativeUsdSync(id);
}
