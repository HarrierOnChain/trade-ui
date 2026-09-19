"use client";
import { useEffect, useMemo, useRef } from "react";
import { mergeDexLabel } from "../lib/format";
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
  const vol = num(row.total_sol_volume ?? row.volume_24h);
  const tradeCount = num(row.trade_count);
  const fees = num(row.fees_total);
  const traders = num(row.unique_traders ?? row.holders);
  const buyCount = num(row.buy_count);
  const sellCount = num(row.sell_count);
  const deploys = num(row.deploys_by_creator ?? row.creator_deploys ?? row.creatorDeploys);
  const migrations = num(
    row.migrations_by_creator ?? row.creator_migrations ?? row.creatorMigrations,
  );
  const buySol = num(row.creator_buy_sol ?? row.creatorBuySol);
  const buyTokens = num(row.creator_buy_tokens ?? row.creatorBuyTokens);
  const buyPrice = num(row.creator_buy_price ?? row.creatorBuyPrice);

  if (bundle != null) patch.bundlePercentage = bundle;
  if (sniper != null) patch.sniperPercentage = sniper;
  if (vol != null) {
    patch.volume24h = vol;
    patch.totalSolVolume = vol;
  }
  if (tradeCount != null) patch.tradeCount = tradeCount;
  if (fees != null) patch.feesTotal = fees;
  if (traders != null) {
    patch.uniqueTraders = traders;
    patch.holders = traders;
  }
  if (buyCount != null) patch.buyCount = buyCount;
  if (sellCount != null) patch.sellCount = sellCount;
  if (deploys != null) patch.creatorDeploys = deploys;
  if (migrations != null) patch.creatorMigrations = migrations;
  if (buySol != null) patch.creatorBuySol = buySol;
  if (buyTokens != null) patch.creatorBuyTokens = buyTokens;
  if (buyPrice != null) patch.creatorBuyPrice = buyPrice;
  if (row.signer) patch.signer = row.signer;
  if (row.platform) patch.dex = row.platform;
  if (row.name) patch.name = row.name;
  if (row.symbol) patch.symbol = row.symbol;
  if (row.uri) patch.uri = row.uri;
  return patch;
}

function mergeBatchPatch(t: TokenEvent, patch: Partial<TokenEvent>): TokenEvent {
  if (Object.keys(patch).length === 0) return t;
  return {
    ...t,
    ...patch,
    uri: t.uri || patch.uri || t.uri,
    name: t.name || patch.name || t.name,
    symbol: t.symbol || patch.symbol || t.symbol,
    // Never relabel a pump-family launchpad (Mayhem) to the pumpfun/pumpswap
    // trade venue the enrich row reports.
    dex: mergeDexLabel(t.dex, patch.dex),
  };
}

/**
 * Batched stats/volume enrichment only. Images + metadata resolve via
 * `useRowImage` (deferred) so this hook never floods the wire with
 * proxy.uri / raze.get — that was starving raze.feed stream delivery.
 */
export function useTokenEnrichment(
  tokens: TokenEvent[],
  setTokens: React.Dispatch<React.SetStateAction<TokenEvent[]>>,
  maxRows = 20,
  resetKey = 0,
) {
  const prevResetKey = useRef(resetKey);
  const prevMintsKey = useRef("");

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
            const merged = mergeBatchPatch(t, applyBatchEntry(row));
            if (merged === t) return t;
            dirty = true;
            return merged;
          });
          return dirty ? next : prev;
        });
      });
    }, 600);

    return () => clearTimeout(timer);
  }, [mintsKey, setTokens, maxRows, resetKey]);
}
