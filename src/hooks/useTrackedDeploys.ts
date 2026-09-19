"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchSignerCounts, fetchTokenMeta } from "../api/client";
import { normalizeRestToken, normalizeTokenEvent } from "../api/normalize";
import { RazeWebSocket } from "../api/websocket";
import type { TokenEvent } from "../types";
import type { TrackedWallet } from "./useTrackerStream";

/**
 * Tracked-wallet deploy stream.
 *
 * Mirrors `useTrackerStream` but for `type: "deploy"` events instead of
 * trades. History comes from `/api/sol/tokens/signer/:addr/counts?tokens=true`
 * (per wallet) followed by a `/tokens/mint/:mint` enrichment for each mint.
 * Live events come from the global "deploy" WS topic, filtered to ones
 * whose `signer` matches a tracked wallet.
 */

export interface TrackedDeploy extends TokenEvent {
  /** Wallet entry that this deploy was attributed to. */
  walletId: string;
  /** Friendly label for the wallet (kept in sync with the registry). */
  walletLabel: string;
  /** Unix ms — derived from `created_at` for stable sorting. */
  timestampMs: number;
  /** Whether this row arrived live over the WS (vs REST seed). */
  live: boolean;
  /** True for the first ~6s after a live deploy lands. */
  isNew?: boolean;
}

interface Options {
  /** Cap on stored deploys across all tracked wallets. */
  maxDeploys?: number;
  /** Per-wallet cap on history pulled from `signer/.../counts`. */
  perWalletHistory?: number;
}

const DEFAULT_MAX = 80;
const DEFAULT_PER_WALLET = 5;
const NEW_BADGE_MS = 6_000;

function tokenTimestampMs(t: TokenEvent): number {
  const raw = t.created_at;
  if (!raw) return 0;
  const n = Date.parse(raw);
  return Number.isFinite(n) ? n : 0;
}

export interface UseTrackedDeploys {
  deploys: TrackedDeploy[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Wallet id → number of deploys currently in the buffer. */
  countsByWallet: Record<string, number>;
}

export function useTrackedDeploys(
  wallets: TrackedWallet[],
  options: Options = {},
): UseTrackedDeploys {
  const { maxDeploys = DEFAULT_MAX, perWalletHistory = DEFAULT_PER_WALLET } = options;

  const [deploys, setDeploys] = useState<TrackedDeploy[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Stable map of address → wallet so the WS handler can resolve labels
  // without re-running the subscribe effect on every label edit.
  const walletByAddrRef = useRef<Map<string, TrackedWallet>>(new Map());
  useEffect(() => {
    const m = new Map<string, TrackedWallet>();
    for (const w of wallets) {
      if (!w.address) continue;
      m.set(w.address, w);
    }
    walletByAddrRef.current = m;
  }, [wallets]);

  const addressKey = useMemo(
    () =>
      Array.from(
        new Set(wallets.map((w) => w.address).filter(Boolean) as string[]),
      )
        .sort()
        .join(","),
    [wallets],
  );

  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  // ── REST seed: per-wallet signer counts → per-token metadata ───────────
  useEffect(() => {
    const seenAddr = new Set<string>();
    const list: TrackedWallet[] = [];
    for (const w of wallets) {
      if (!w.address || seenAddr.has(w.address)) continue;
      seenAddr.add(w.address);
      list.push(w);
    }
    if (list.length === 0 || perWalletHistory <= 0) {
      setDeploys([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.allSettled(
      list.map(async (w) => {
        const res = await fetchSignerCounts(w.address, true);
        const mints = (res.data?.deployTokens ?? []).slice(0, perWalletHistory);
        const tokens = await Promise.all(
          mints.map((mint) =>
            fetchTokenMeta(mint)
              .then((meta) => normalizeRestToken(meta as unknown as Record<string, unknown>))
              .catch(() => null),
          ),
        );
        return { wallet: w, tokens: tokens.filter((t): t is TokenEvent => !!t) };
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const merged: TrackedDeploy[] = [];
        const seen = new Set<string>();
        let anyError = false;
        for (const r of results) {
          if (r.status === "rejected") {
            anyError = true;
            continue;
          }
          for (const t of r.value.tokens) {
            if (!t.mint_address || seen.has(t.mint_address)) continue;
            seen.add(t.mint_address);
            // Backend doesn't always echo the signer on the mint detail; pin
            // the wallet we asked about so the row label is correct even when
            // the field is missing on the response.
            merged.push({
              ...t,
              signer: t.signer || r.value.wallet.address,
              walletId: r.value.wallet.id,
              walletLabel: r.value.wallet.label,
              timestampMs: tokenTimestampMs(t),
              live: false,
            });
          }
        }
        merged.sort((a, b) => b.timestampMs - a.timestampMs);
        setDeploys(merged.slice(0, maxDeploys));
        if (anyError && merged.length === 0) {
          setError("Failed to load deploy history.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [addressKey, refreshTick, maxDeploys, perWalletHistory, wallets]);

  // ── Live deploys: subscribe to the global "deploy" topic, filter by signer
  useEffect(() => {
    if (!addressKey) return;

    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribe(["deploy"]);

    const handler = (msg: Record<string, unknown>) => {
      const token = normalizeTokenEvent(msg);
      if (!token || !token.signer) return;
      const wallet = walletByAddrRef.current.get(token.signer);
      if (!wallet) return;
      const ts = tokenTimestampMs(token) || Date.now();
      const incoming: TrackedDeploy = {
        ...token,
        walletId: wallet.id,
        walletLabel: wallet.label,
        timestampMs: ts,
        live: true,
        isNew: true,
      };

      setDeploys((prev) => {
        if (prev.some((d) => d.mint_address === incoming.mint_address)) return prev;
        return [incoming, ...prev].slice(0, maxDeploys);
      });

      window.setTimeout(() => {
        setDeploys((prev) =>
          prev.map((d) =>
            d.mint_address === incoming.mint_address ? { ...d, isNew: false } : d,
          ),
        );
      }, NEW_BADGE_MS);
    };

    const off = ws.on("deploy", handler);
    return () => {
      off();
    };
  }, [addressKey, maxDeploys]);

  const countsByWallet = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of deploys) counts[d.walletId] = (counts[d.walletId] ?? 0) + 1;
    return counts;
  }, [deploys]);

  return { deploys, loading, error, refresh, countsByWallet };
}
