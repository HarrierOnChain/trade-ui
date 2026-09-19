"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchFundingLookup, type FundingInfo } from "../api/client";

/**
 * Module-level cache keyed by wallet address. Survives across hook instances
 * and page navigations within the SPA — switching from Holders → Bubblemap
 * tab doesn't refetch already-resolved funding entries.
 *
 * Values:
 *   FundingInfo                   — wallet has been resolved and was funded
 *   null                          — wallet has been resolved and either has
 *                                   no funding record (rpc_unresolved) or
 *                                   the backend returned null without
 *                                   enqueuing further work
 *   { pending: true, attempt: N } — backend enqueued an RPC/CH backfill;
 *                                   we'll re-poll until resolved or max
 *                                   attempts exhausted
 *   undefined                     — wallet not yet looked up
 */
type PendingMark = { pending: true; attempt: number; nextAt: number };
type CacheValue = FundingInfo | null | PendingMark;

function isPending(v: CacheValue | undefined): v is PendingMark {
  return !!v && typeof v === "object" && (v as PendingMark).pending === true;
}

const cache = new Map<string, CacheValue>();
const inflight = new Set<string>();

/** Bus that wakes every active useFunding hook when the cache changes. */
type Listener = () => void;
const listeners = new Set<Listener>();
function notify() {
  for (const l of listeners) l();
}

const DEBOUNCE_MS = 150;
const BATCH_LIMIT = 150;
const MAX_PENDING_ATTEMPTS = 12;     // ~12 attempts × ~5–10s = 1–2 min cap
const PENDING_RETRY_BASE_MS = 4000;  // grows linearly per attempt

let pending: Set<string> = new Set();
let timer: ReturnType<typeof setTimeout> | null = null;

function nextRetryDelay(attempt: number): number {
  // Linear backoff: 4s, 6s, 8s, 10s, ... capped at 20s
  return Math.min(PENDING_RETRY_BASE_MS + attempt * 2000, 20000);
}

function flush() {
  timer = null;
  if (pending.size === 0) return;
  const batch = Array.from(pending).slice(0, BATCH_LIMIT);
  pending = new Set(Array.from(pending).slice(BATCH_LIMIT));
  for (const w of batch) inflight.add(w);

  fetchFundingLookup(batch)
    .then((res) => {
      const map = res?.fundings ?? {};
      // Wallets the backend says it queued for backfill — mark them as
      // pending so we re-poll instead of caching the current null.
      const enqueued = new Set<string>(res?.enrichmentEnqueued ?? []);
      const now = Date.now();
      for (const w of batch) {
        const value = map[w];
        if (value) {
          // Resolved with a funding row.
          cache.set(w, value);
        } else if (enqueued.has(w)) {
          // Backend enqueued a backfill — mark pending and schedule retry.
          const prev = cache.get(w);
          const attempt = isPending(prev) ? prev.attempt + 1 : 1;
          if (attempt > MAX_PENDING_ATTEMPTS) {
            // Give up after enough retries — show as unresolved.
            cache.set(w, null);
          } else {
            const nextAt = now + nextRetryDelay(attempt);
            cache.set(w, { pending: true, attempt, nextAt });
            schedulePendingRetry(w, nextAt - now);
          }
        } else {
          // Backend has a row already (maybe rpc_unresolved sentinel).
          // Either way it returned null with no further enqueue → terminal.
          cache.set(w, null);
        }
        inflight.delete(w);
      }
      notify();
      if (pending.size > 0 && timer == null) {
        timer = setTimeout(flush, DEBOUNCE_MS);
      }
    })
    .catch(() => {
      // On error, drop in-flight markers but DON'T cache nulls — let a future
      // retry attempt the lookup again.
      for (const w of batch) inflight.delete(w);
    });
}

/** Re-poll scheduler for wallets the backend has enqueued for backfill. */
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
function schedulePendingRetry(wallet: string, delayMs: number) {
  const existing = retryTimers.get(wallet);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    retryTimers.delete(wallet);
    // Re-issue a lookup for just this wallet by forcing a re-enqueue.
    if (!inflight.has(wallet) && !pending.has(wallet)) {
      pending.add(wallet);
      if (timer == null) timer = setTimeout(flush, DEBOUNCE_MS);
    }
  }, delayMs);
  retryTimers.set(wallet, t);
}

function enqueue(addrs: string[]) {
  let added = 0;
  for (const a of addrs) {
    if (!a) continue;
    const cached = cache.get(a);
    // Skip already-resolved entries (FundingInfo or terminal null).
    if (cached !== undefined && !isPending(cached)) continue;
    if (inflight.has(a)) continue;
    if (pending.has(a)) continue;
    pending.add(a);
    added++;
  }
  if (added > 0 && timer == null) {
    timer = setTimeout(flush, DEBOUNCE_MS);
  }
}

/**
 * Look up funding info for a set of wallets. Returns a map keyed by address.
 *
 * Resolved entries are cached module-wide so navigating across tabs is free.
 * Unresolved entries (`undefined`) trigger a debounced batched fetch.
 */
export function useFunding(addresses: string[] | null | undefined) {
  const stable = useMemo(() => {
    if (!addresses) return [] as string[];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const a of addresses) {
      if (a && !seen.has(a)) {
        seen.add(a);
        out.push(a);
      }
    }
    return out;
  }, [addresses]);

  const [, force] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const listener = () => {
      if (mounted.current) force((n) => n + 1);
    };
    listeners.add(listener);
    return () => {
      mounted.current = false;
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    enqueue(stable);
  }, [stable]);

  const fundings = useMemo(() => {
    const out = new Map<string, FundingInfo | null | "pending" | undefined>();
    for (const a of stable) {
      const v = cache.get(a);
      if (v === undefined) {
        out.set(a, undefined);
      } else if (isPending(v)) {
        out.set(a, "pending");
      } else {
        out.set(a, v);
      }
    }
    return out;
  }, [stable]);

  const allResolved = stable.every((a) => {
    const v = cache.get(a);
    return v !== undefined && !isPending(v);
  });

  return { fundings, loading: !allResolved };
}

/** Imperative helper for non-hook contexts (used by the bubblemap loader). */
export async function lookupFundingDirect(
  addresses: string[],
): Promise<Map<string, FundingInfo | null>> {
  const out = new Map<string, FundingInfo | null>();
  const need: string[] = [];
  for (const a of addresses) {
    const cached = cache.get(a);
    if (cached !== undefined && !isPending(cached)) {
      out.set(a, cached);
    } else {
      need.push(a);
    }
  }
  for (let i = 0; i < need.length; i += BATCH_LIMIT) {
    const slice = need.slice(i, i + BATCH_LIMIT);
    const res = await fetchFundingLookup(slice);
    for (const a of slice) {
      const v = res?.fundings?.[a] ?? null;
      cache.set(a, v);
      out.set(a, v);
    }
  }
  notify();
  return out;
}
