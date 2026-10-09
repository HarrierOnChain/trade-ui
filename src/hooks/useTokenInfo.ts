"use client";
import { useEffect, useState } from "react";
import { fetchTokenInfo } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import { defined } from "../api/mappers";
import { friendlyFetchError } from "../api/chainError";
import { fetchPublicMetadata, seedPublicMetadata } from "../api/metadata";
import type { TokenEvent } from "../types";

const num = (v: unknown) =>
  typeof v === "number" && isFinite(v)
    ? v
    : typeof v === "string" && isFinite(Number(v))
    ? Number(v)
    : undefined;

/**
 * Resolve a full token record for the detail page.
 *
 * One token read (stats, safety, launchpad) so the header populates mcap /
 * volume / trade count without per-mint trades scans; the `token` channel
 * keeps it live.
 */
export function useTokenInfo(mint: string | null) {
  const [info, setInfo] = useState<TokenEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mint) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const basePromise = fetchTokenInfo(mint)
      .then((res) => res.data ?? null)
      .catch((e) => {
        if (!cancelled) setError(friendlyFetchError(e));
        return null;
      });

    const publicMetaPromise = fetchPublicMetadata(mint).catch(
      () => ({} as Awaited<ReturnType<typeof fetchPublicMetadata>>)
    );

    basePromise
      .then((base) => {
        if (cancelled) return;
        if (!base) {
          setInfo(null);
          void publicMetaPromise.then((meta) => {
            if (cancelled) return;
            const name = meta.name?.trim() ?? "";
            const symbol = meta.symbol?.trim() ?? "";
            if (!name && !symbol) return;
            setInfo({
              mint_address: mint,
              name,
              symbol,
              dex: "",
              created_at: "",
            } as TokenEvent);
          });
          return;
        }
        const merged: TokenEvent = { ...base };
        seedPublicMetadata(mint, {
          name: merged.name,
          symbol: merged.symbol,
          image: merged.image ?? undefined,
          twitter: merged.twitter ?? undefined,
          telegram: merged.telegram ?? undefined,
          website: merged.website ?? undefined,
        });
        setInfo(merged);

        const needsIdentity = !merged.name?.trim() || !merged.symbol?.trim();
        if (!needsIdentity) return;

        void publicMetaPromise.then((meta) => {
          if (cancelled) return;

          const patch: Partial<TokenEvent> = {};
          const name = meta.name?.trim() ?? "";
          const symbol = meta.symbol?.trim() ?? "";

          if (!merged.name?.trim() && name) patch.name = name;
          if (!merged.symbol?.trim() && symbol) patch.symbol = symbol;
          if (Object.keys(patch).length === 0) return;

          setInfo((prev) => {
            if (!prev || prev.mint_address !== mint) return prev;
            return { ...prev, ...patch };
          });
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mint]);

  // Live: the API's `token` channel — a `tick` (price, market cap, liquidity)
  // on every trade and the whole Token again every ≤15 s while it trades
  // (holders, 24h stats, curve). Coalesced to one render a second: several
  // components on a token page each hold this hook.
  useEffect(() => {
    if (!mint) return;
    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribeToken(mint, ["token"], { sse: true });
    let pending: Partial<TokenEvent> = {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const patch = pending;
      pending = {};
      setInfo((prev) => (prev && prev.mint_address === mint ? { ...prev, ...patch } : prev));
    };
    const queue = (patch: Partial<TokenEvent>) => {
      Object.assign(pending, defined(patch));
      if (timer == null) timer = setTimeout(flush, 1_000);
    };
    const offTick = ws.on("tick", (msg) => {
      if (msg.tokenMint !== mint) return;
      queue({
        marketCap: num(msg.marketCapUsd),
        lastPrice: num(msg.lastPrice),
        liquidity: num(msg.liquidityUsd),
      });
    });
    const offToken = ws.on("token", (msg) => {
      if (msg.tokenMint !== mint || !msg.token) return;
      const t = msg.token as TokenEvent;
      queue({
        marketCap: t.marketCap,
        lastPrice: t.lastPrice,
        liquidity: t.liquidity,
        holders: t.holders,
        priceChange: t.priceChange,
        volume24h: t.volume24h,
        totalSolVolume: t.totalSolVolume,
        tradeCount: t.tradeCount,
        buyCount: t.buyCount,
        sellCount: t.sellCount,
        graduationPercent: t.graduationPercent,
        migrated_at: t.migrated_at,
        bundlePercentage: t.bundlePercentage,
        sniperPercentage: t.sniperPercentage,
      });
    });
    return () => {
      offTick();
      offToken();
      if (timer != null) clearTimeout(timer);
      ws.unsubscribeToken(mint, ["token"], { sse: true });
    };
  }, [mint]);

  return { info, loading, error };
}
