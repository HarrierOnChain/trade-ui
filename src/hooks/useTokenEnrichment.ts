"use client";
import { useEffect, useMemo, useRef } from "react";
import {
  queueBatchEnrich,
  resetBatchEnrichClaims,
  type BatchEnrichEntry,
} from "../lib/batchEnrichCoordinator";
import type { TokenEvent } from "../types";

const num = (v: unknown) =>
  typeof v === "number" && isFinite(v)
    ? v
    : typeof v === "string" && isFinite(Number(v))
    ? Number(v)
    : undefined;

function applyBatchEntry(row: BatchEnrichEntry): Partial<TokenEvent> {
  const patch: Partial<TokenEvent> = {};
  const bundle = num(row.bundle_percentage);
  const sniper = num(row.sniper_percentage);
  // Units stay apart: `volume_24h` is USD, `total_sol_volume` is the chain's
  // native coin. Storing USD as SOL multiplied every row's volume by ~100.
  const volUsd = num(row.volume_24h);
  const volNative = num(row.total_sol_volume);
  const tradeCount = num(row.trade_count);
  const holders = num(row.holders);
  const change = num(row.priceChange);
  const buyCount = num(row.buy_count);
  const sellCount = num(row.sell_count);
  const deploys = num(row.creatorDeploys);

  if (bundle != null) patch.bundlePercentage = bundle;
  if (sniper != null) patch.sniperPercentage = sniper;
  if (volUsd != null) patch.volume24h = volUsd;
  if (volNative != null) patch.totalSolVolume = volNative;
  if (tradeCount != null) patch.tradeCount = tradeCount;
  if (holders != null) patch.holders = holders;
  if (change != null) patch.priceChange = change;
  if (buyCount != null) patch.buyCount = buyCount;
  if (sellCount != null) patch.sellCount = sellCount;
  if (deploys != null) patch.creatorDeploys = deploys;
  for (const k of SHARE_KEYS) {
    const v = num(row[k]);
    if (v != null) patch[k] = v;
  }
  for (const k of SOCIAL_KEYS) if (row[k]) patch[k] = row[k];
  if (row.signer) patch.signer = row.signer;
  if (row.platform) patch.dex = row.platform;
  if (row.name) patch.name = row.name;
  if (row.symbol) patch.symbol = row.symbol;
  return patch;
}

/** Safety shares the batch read carries (percent). */
const SHARE_KEYS = [
  "top10Percent",
  "devPercent",
  "insidersPercent",
  "freshWalletsPercent",
  "botsPercent",
  "bluechipPercent",
] as const;

/** Every safety field, for `keepSafety`. */
const SAFETY_KEYS = [
  ...SHARE_KEYS,
  "bundlePercentage",
  "sniperPercentage",
  "creatorDeploys",
] as const;

const SOCIAL_KEYS = ["twitter", "website", "telegram", "discord"] as const;

function mergeBatchPatch(t: TokenEvent, patch: Partial<TokenEvent>, keepSafety: boolean): TokenEvent {
  // Links only fill gaps: a row's own socials are never replaced.
  for (const k of SOCIAL_KEYS) if (t[k]) delete patch[k];
  if (keepSafety) for (const k of SAFETY_KEYS) if (t[k] != null) delete patch[k];
  if (Object.keys(patch).length === 0) return t;
  return {
    ...t,
    ...patch,
    name: t.name || patch.name || t.name,
    symbol: t.symbol || patch.symbol || t.symbol,
    // The board's launchpad is the row's label and filter key: enrichment
    // only fills it when the row has none.
    dex: t.dex || patch.dex || "",
  };
}

/**
 * Batched stats/volume enrichment only. Images + metadata resolve via
 * `useRowImage` (deferred) so this hook never floods the network with
 * per-token metadata reads.
 */
export function useTokenEnrichment(
  tokens: TokenEvent[],
  setTokens: React.Dispatch<React.SetStateAction<TokenEvent[]>>,
  maxRows = 20,
  resetKey = 0,
  opts: { keepSafety?: boolean } = {},
) {
  const prevResetKey = useRef(resetKey);
  const prevMintsKey = useRef("");
  const keepSafety = opts.keepSafety === true;

  const mintsKey = useMemo(
    () =>
      tokens
        .slice(0, maxRows)
        .map((t) => t.mint_address)
        .filter(Boolean)
        .join(","),
    [tokens, maxRows],
  );

  useEffect(() => {
    if (resetKey !== prevResetKey.current) {
      resetBatchEnrichClaims();
      prevResetKey.current = resetKey;
      prevMintsKey.current = "";
    }

    if (!mintsKey) return;

    if (mintsKey !== prevMintsKey.current) {
      prevMintsKey.current = mintsKey;
    }

    const mints = new Set(mintsKey.split(",").filter(Boolean));

    const timer = setTimeout(() => {
      queueBatchEnrich([...mints], (data) => {
        setTokens((prev) => {
          let dirty = false;
          const next = prev.map((t) => {
            if (!mints.has(t.mint_address)) return t;
            const row = data[t.mint_address];
            if (!row) return t;
            const merged = mergeBatchPatch(t, applyBatchEntry(row), keepSafety);
            if (merged === t) return t;
            dirty = true;
            return merged;
          });
          return dirty ? next : prev;
        });
      });
    }, 600);

    return () => clearTimeout(timer);
  }, [mintsKey, setTokens, maxRows, resetKey, keepSafety]);
}
