"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchTokenInfo } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import { defined } from "../api/mappers";
import { friendlyFetchError } from "../api/chainError";
import { fetchMetadataFromUri, fetchPublicMetadata, getCachedPublicMetadata, seedPublicMetadata } from "../api/metadata";
import { mergeDexLabel } from "../lib/format";
import { normalizeRestToken } from "../api/normalize";
import { getPreviewData, isPreviewMint, isStreamOnly, subscribePreview } from "../lib/previewData";
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
 * Fans out deploy info + one batched enrich call so the header populates
 * mcap / volume / fees / trade count without per-mint trades scans.
 */
export function useTokenInfo(mint: string | null) {
  const [info, setInfo] = useState<TokenEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview-mode short-circuit: the /deploy page registers a synthetic
  // snapshot under a placeholder mint and re-registers on every form edit.
  // Subscribing here keeps re-renders cheap (only the deploy surface emits)
  // and skips the REST fan-out entirely for non-existent mints.
  const previewSnapshot = usePreviewSnapshot(mint);

  useEffect(() => {
    if (!mint) {
      setInfo(null);
      return;
    }
    // Preview mints have no on-chain state; skip the REST fan-out.
    if (isPreviewMint(mint)) {
      setInfo(previewSnapshot?.tokenInfo ?? null);
      setLoading(false);
      setError(null);
      return;
    }
    // Stream-only (freshly-deployed) mint: no REST history fan-out. Seed the
    // header from the metadata the deploy form already pushed; live price /
    // volume / holders fill in from the WS hooks.
    if (isStreamOnly(mint)) {
      const meta = getCachedPublicMetadata(mint);
      setInfo({
        mint_address: mint,
        name: meta?.name ?? "",
        symbol: meta?.symbol ?? "",
        dex: "pumpfun",
        image: meta?.image ?? null,
        twitter: meta?.twitter ?? null,
        telegram: meta?.telegram ?? null,
        website: meta?.website ?? null,
        created_at: new Date().toISOString(),
      } as TokenEvent);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const basePromise = fetchTokenInfo(mint)
      .then((res) => {
        const raw = (res?.data ?? res) as unknown as Record<string, unknown> | null;
        return raw ? normalizeRestToken(raw) : null;
      })
      .catch((e) => {
        if (!cancelled) setError(friendlyFetchError(e));
        return null;
      });

    const publicMetaPromise = fetchPublicMetadata(mint).catch(
      () => ({} as Awaited<ReturnType<typeof fetchPublicMetadata>>)
    );

    // The single-token read already carries stats, safety and launchpad; the
    // batch enrich endpoint would only repeat it.
    const enrichPromise = Promise.resolve({} as Partial<TokenEvent>);

    Promise.all([basePromise, enrichPromise])
      .then(async ([base, enrich]) => {
        if (cancelled) return;
        if (!base && Object.keys(enrich).length === 0) {
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
        const merged: TokenEvent = {
          ...(base ?? ({ mint_address: mint, name: "", symbol: "", dex: "", created_at: "" } as TokenEvent)),
          ...enrich,
        };
        // Keep a pump-family launchpad (Mayhem) label from being relabeled to the
        // pumpfun/pumpswap trade venue the enrich row carries.
        merged.dex = mergeDexLabel(base?.dex, enrich.dex);
        if (merged.holders == null && merged.uniqueTraders != null) {
          merged.holders = merged.uniqueTraders;
        }
        seedPublicMetadata(mint, {
          name: merged.name,
          symbol: merged.symbol,
          image: merged.image ?? undefined,
          twitter: merged.twitter ?? undefined,
          telegram: merged.telegram ?? undefined,
          website: merged.website ?? undefined,
          uri: merged.uri ?? undefined,
        });
        // If no direct image URL, try resolving from the metadata URI
        if (!merged.image && merged.uri) {
          try {
            const httpUri = merged.uri.startsWith("ipfs://")
              ? `https://ipfs.io/ipfs/${merged.uri.slice(7)}`
              : merged.uri;
            const meta = await fetchMetadataFromUri(httpUri);
            const raw = meta.image;
            if (raw) {
              merged.image = raw.startsWith("ipfs://")
                ? `https://ipfs.io/ipfs/${raw.slice(7)}`
                : raw;
              seedPublicMetadata(mint, { image: merged.image });
            }
          } catch { /* keep image null */ }
        }
        if (!cancelled) setInfo(merged);

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
  }, [mint, previewSnapshot]);

  // Live: the API's `token` channel — a `tick` (price, market cap, liquidity)
  // on every trade and the whole Token again every ≤15 s while it trades
  // (holders, 24h stats, curve). Coalesced to one render a second: several
  // components on a token page each hold this hook.
  useEffect(() => {
    if (!mint || isPreviewMint(mint)) return;
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

/** Subscribe to the preview registry so a hook re-renders when the deploy
 *  page re-publishes a synthetic snapshot for `mint`. Returns `null` for
 *  non-preview mints (zero overhead — the subscribe callback is a no-op). */
function usePreviewSnapshot(mint: string | null) {
  return useSyncExternalStore(
    (cb) => (mint ? subscribePreview(mint, cb) : () => {}),
    () => (mint ? getPreviewData(mint) : null),
    () => null,
  );
}
