"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchPerpWalletTrades, type PerpSide } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import type { TrackedWallet, WalletSource } from "./useTrackerStream";

const PER_WALLET_SEED_LIMIT = 25;
const NEW_FLASH_MS = 6_000;

export interface TrackedPerpFill {
  /** Stable id (signature + market + side). */
  id: string;
  signer: string;
  walletLabel: string;
  walletId: string;
  walletSource: WalletSource;
  marketId: string;
  venue: string;
  side: PerpSide;
  /** Plain USD (e6 → /1e6). */
  sizeUsd: number;
  /** Plain USD price. */
  priceUsd: number;
  /** Plain USD fee. */
  feeUsd: number;
  signature: string;
  /** Unix ms. */
  timestamp: number;
  /** True for the first ~6s after a fresh fill arrives. */
  isNew?: boolean;
}

interface State {
  fills: TrackedPerpFill[];
  loading: boolean;
}

const e6 = (n: number) => n / 1_000_000;

function fillId(signature: string, signer: string, marketId: string, side: PerpSide, ts: number) {
  if (signature) return `${signature}:${marketId}:${side}`;
  return `${signer}:${marketId}:${side}:${ts}`;
}

function venueFromMarketId(marketId: string): string {
  const idx = marketId.indexOf(":");
  return idx > 0 ? marketId.slice(0, idx) : "";
}

/**
 * Streams perp fills for every tracked wallet in real time over the Raze
 * WebSocket, mirroring the spot `useTrackerStream` pattern. On wallet-set
 * changes we do a one-shot REST seed via `/perp/wallets/{address}/perp-trades`
 * for backfill, then subscribe to the wallet signers and append every
 * `perp_fill` event whose signer matches. Brand-new fills get an `isNew`
 * flash for ~6s so the AlertsPanel can highlight them.
 */
export function useTrackedPerps(wallets: TrackedWallet[], maxFills = 200) {
  const [state, setState] = useState<State>({ fills: [], loading: false });

  // Stable wallet key so identity-only re-renders don't restart subscriptions.
  const walletKey = useMemo(
    () =>
      wallets
        .map((w) => `${w.id}|${w.address}|${w.label}|${w.source}`)
        .sort()
        .join("\n"),
    [wallets],
  );

  // Address → wallet lookup, kept in a ref so the WS handler can resolve
  // labels without re-subscribing on every label edit. User entries win
  // over watchlist entries when an address appears under both sources.
  const walletByAddrRef = useRef<Map<string, TrackedWallet>>(new Map());
  useEffect(() => {
    const m = new Map<string, TrackedWallet>();
    for (const w of wallets) {
      if (!w.address) continue;
      const existing = m.get(w.address);
      if (existing && existing.source === "user") continue;
      m.set(w.address, w);
    }
    walletByAddrRef.current = m;
  }, [wallets]);

  const flashTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Sorted address key — re-runs the WS subscribe effect only when the
  // actual address set changes (label edits don't reopen the stream).
  const addressKey = useMemo(
    () =>
      Array.from(new Set(wallets.map((w) => w.address).filter(Boolean) as string[]))
        .sort()
        .join(","),
    [wallets],
  );

  // ── REST seed ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!wallets.length) {
      setState({ fills: [], loading: false });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    const seenAddr = new Set<string>();
    const live = wallets.filter((w) => {
      if (!w.address || seenAddr.has(w.address)) return false;
      seenAddr.add(w.address);
      return true;
    });

    Promise.allSettled(
      live.map(async (w) => {
        const r = await fetchPerpWalletTrades(w.address, PER_WALLET_SEED_LIMIT);
        if (!Array.isArray(r?.data)) return [] as TrackedPerpFill[];
        return r.data.map<TrackedPerpFill>((t) => ({
          id: fillId(t.signature ?? "", t.signer || w.address, t.market_id, t.side, t.timestamp ?? 0),
          signer: t.signer || w.address,
          walletLabel: w.label,
          walletId: w.id,
          walletSource: w.source,
          marketId: t.market_id,
          venue: t.venue,
          side: t.side,
          sizeUsd: e6(t.size),
          priceUsd: e6(t.price),
          feeUsd: e6(t.fee),
          signature: t.signature ?? "",
          timestamp: t.timestamp ?? 0,
        }));
      }),
    ).then((results) => {
      if (cancelled) return;
      const merged: TrackedPerpFill[] = [];
      const seen = new Set<string>();
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        for (const fill of r.value) {
          if (seen.has(fill.id)) continue;
          seen.add(fill.id);
          merged.push(fill);
        }
      }
      merged.sort((a, b) => b.timestamp - a.timestamp);
      setState({ fills: merged.slice(0, maxFills), loading: false });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletKey, maxFills]);

  // ── WS signer subscription (live perp fills) ─────────────────────────────
  useEffect(() => {
    const addresses = addressKey ? addressKey.split(",").filter(Boolean) : [];
    if (addresses.length === 0) return;

    // No perp channel on this API: listen only (a wallet subscription would
    // stream spot swaps nobody here reads).
    const ws = RazeWebSocket.getInstance();

    const handleFill = (msg: Record<string, unknown>) => {
      const data = msg.data as Record<string, unknown> | undefined;
      if (!data) return;
      const signer = String(data.signer ?? "");
      if (!signer) return;
      const wallet = walletByAddrRef.current.get(signer);
      if (!wallet) return;

      const marketId = String(msg.market_id ?? "");
      if (!marketId) return;

      const signature = String(data.signature ?? "");
      const side = (data.side === "short" ? "short" : "long") as PerpSide;
      const ts = ((data.block_time as number) ?? 0) * 1000 || Date.now();
      const id = fillId(signature, signer, marketId, side, ts);

      const fill: TrackedPerpFill = {
        id,
        signer,
        walletLabel: wallet.label,
        walletId: wallet.id,
        walletSource: wallet.source,
        marketId,
        venue: venueFromMarketId(marketId),
        side,
        sizeUsd: e6(Number(data.size) || 0),
        priceUsd: e6(Number(data.price) || 0),
        feeUsd: e6(Number(data.fee) || 0),
        signature,
        timestamp: ts,
        isNew: true,
      };

      setState((prev) => {
        if (prev.fills.some((f) => f.id === id)) return prev;
        const next = [fill, ...prev.fills].slice(0, maxFills);
        return { fills: next, loading: false };
      });

      const timers = flashTimersRef.current;
      const prevTimer = timers.get(id);
      if (prevTimer) clearTimeout(prevTimer);
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          setState((s) => ({
            ...s,
            fills: s.fills.map((x) => (x.id === id ? { ...x, isNew: false } : x)),
          }));
        }, NEW_FLASH_MS),
      );
    };

    const off = ws.on("perp_fill", handleFill);
    return () => {
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressKey, maxFills]);

  useEffect(() => {
    return () => {
      for (const t of flashTimersRef.current.values()) clearTimeout(t);
      flashTimersRef.current.clear();
    };
  }, []);

  return state;
}
