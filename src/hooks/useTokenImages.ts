"use client";
/**
 * Real logos for tokens the UI names without a row from the API (the swap
 * cards' known tokens and quote assets): one batch read of `/tokens`. The
 * chain's coin is looked up as its wrapped token (WSOL, WETH, WBNB), which the
 * API gives the coin's logo.
 *
 * The URLs never change for a token (the API's /media, cached a year), so the
 * ones found are also kept in this browser's storage: on the next visit a logo
 * renders at once, from the browser's cache, with no lookup first.
 */
import { useEffect, useMemo, useState } from "react";
import { fetchTokenImages } from "../api/client";
import type { ChainId } from "../lib/chains";
import { preloadTokenImage } from "../lib/tokenImages";

/** The wrapped token whose logo stands for the chain's coin. */
export const WRAPPED_NATIVE: Partial<Record<ChainId, string>> = {
  sol: "So11111111111111111111111111111111111111112",
  eth: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  base: "0x4200000000000000000000000000000000000006",
  bsc: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
};

const STORE_KEY = "raze.tokenImages.v1";
const STORE_MAX = 400;

/** `${chain}:${address}` → image URL, or null once asked and not found. */
const known = new Map<string, string | null>();
/** Lookups in flight, so a hook and a prefetch ask once. */
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let restored = false;

const keyOf = (chain: string, address: string) => `${chain}:${chain === "sol" ? address : address.toLowerCase()}`;

function restore(): void {
  if (restored || typeof window === "undefined") return;
  restored = true;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const saved = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    for (const [k, v] of Object.entries(saved)) if (typeof v === "string" && /^https:\/\//.test(v)) known.set(k, v);
  } catch {
    /* storage blocked or corrupt: the session's reads still work */
  }
}

function persist(): void {
  try {
    const found = [...known].filter((e): e is [string, string] => typeof e[1] === "string").slice(-STORE_MAX);
    window.localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(found)));
  } catch {
    /* ignore */
  }
}

function resolve(chain: ChainId, address: string | null | undefined): string | null {
  if (!address) return null;
  const a = address === "native" ? WRAPPED_NATIVE[chain] : address;
  if (!a) return null;
  return chain === "sol" ? (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? a : null) : (/^0x[0-9a-fA-F]{40}$/.test(a) ? a : null);
}

/** The logo of `address` on `chain` if already known (`native` for the coin). */
export function tokenImage(chain: ChainId, address: string | null | undefined): string | null {
  restore();
  const a = resolve(chain, address);
  return a ? known.get(keyOf(chain, a)) ?? null : null;
}

/**
 * Look up the logos of `addresses` not known yet (one batch read), and start
 * downloading every logo found. Safe to call often: each token is asked once.
 */
export function prefetchTokenImages(chain: ChainId, addresses: Array<string | null | undefined>): Promise<void> {
  restore();
  const wanted = [...new Set(addresses.map((a) => resolve(chain, a)).filter((a): a is string => Boolean(a)))];
  for (const a of wanted) preloadTokenImage(known.get(keyOf(chain, a)));
  const missing = wanted.filter((a) => !known.has(keyOf(chain, a)) && !pending.has(keyOf(chain, a)));
  const waits = wanted.map((a) => pending.get(keyOf(chain, a))).filter((p): p is Promise<void> => Boolean(p));
  if (missing.length) {
    const p = fetchTokenImages(chain, missing).then(
      (found) => {
        for (const a of missing) {
          const url = found[chain === "sol" ? a : a.toLowerCase()] ?? null;
          known.set(keyOf(chain, a), url);
          preloadTokenImage(url);
        }
        persist();
        listeners.forEach((fn) => fn());
      },
      () => { /* initials stay; asked again next time */ },
    ).finally(() => {
      for (const a of missing) pending.delete(keyOf(chain, a));
    });
    for (const a of missing) pending.set(keyOf(chain, a), p);
    waits.push(p);
  }
  return Promise.all(waits).then(() => {});
}

/**
 * The logos of `addresses` (`native` for the coin): known ones at once, the
 * others looked up, re-rendering when they arrive.
 */
export function useTokenImages(chain: ChainId, addresses: Array<string | null | undefined>): (address: string | null | undefined) => string | null {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wanted = useMemo(() => addresses.filter(Boolean) as string[], [chain, addresses.join(",")]);
  const [, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    listeners.add(bump);
    void prefetchTokenImages(chain, wanted);
    return () => { listeners.delete(bump); };
  }, [chain, wanted]);

  return (address) => tokenImage(chain, address);
}
