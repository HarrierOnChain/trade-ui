"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchTokenInfo, fetchBatchTokenEnrich } from "../api/client";
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

    const enrichPromise = fetchBatchTokenEnrich([mint], 0)
      .then((res) => {
        const row =
          res?.data && typeof res.data === "object"
            ? (res.data[mint] as Record<string, unknown> | undefined)
            : undefined;
        if (!row) return {} as Partial<TokenEvent>;
        const patch: Partial<TokenEvent> = {};
        const mcap = num(row.marketCap ?? row.market_cap);
        const initMc = num(row.initialMarketCap ?? row.initial_market_cap);
        const bundle = num(row.bundlePercentage ?? row.bundle_percentage);
        const sniper = num(row.sniperPercentage ?? row.sniper_percentage);
        const vol24 = num(row.volume24h ?? row.volume_24h ?? row.total_sol_volume);
        const holders = num(row.holders ?? row.unique_traders);
        const change = num(row.priceChange ?? row.price_change);
        const price = num(row.lastPrice ?? row.last_price);
        const tradeCount = num(row.trade_count ?? row.tradeCount);
        const solVolume = num(row.total_sol_volume ?? row.totalSolVolume);
        const feesTotal = num(row.fees_total ?? row.feesTotal);
        const buyCount = num(row.buy_count ?? row.buyCount);
        const sellCount = num(row.sell_count ?? row.sellCount);
        const uniqueTraders = num(row.unique_traders ?? row.uniqueTraders);
        if (mcap != null) patch.marketCap = mcap;
        if (initMc != null) patch.initialMarketCap = initMc;
        if (bundle != null) patch.bundlePercentage = bundle;
        if (sniper != null) patch.sniperPercentage = sniper;
        if (vol24 != null) patch.volume24h = vol24;
        if (holders != null) patch.holders = holders;
        if (change != null) patch.priceChange = change;
        if (price != null) patch.lastPrice = price;
        if (tradeCount != null) patch.tradeCount = tradeCount;
        if (solVolume != null) patch.totalSolVolume = solVolume;
        if (feesTotal != null) patch.feesTotal = feesTotal;
        if (buyCount != null) patch.buyCount = buyCount;
        if (sellCount != null) patch.sellCount = sellCount;
        if (uniqueTraders != null) patch.uniqueTraders = uniqueTraders;
        if (row.name) patch.name = String(row.name);
        if (row.symbol) patch.symbol = String(row.symbol);
        if (row.platform) patch.dex = String(row.platform);
        if (row.signer) patch.signer = String(row.signer);
        return patch;
      })
      .catch(() => ({} as Partial<TokenEvent>));

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
