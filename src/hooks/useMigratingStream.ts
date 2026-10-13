"use client";
import { useMemo } from "react";
import type { ColumnFilters } from "../lib/tokenFilters";
import { fetchDeploys, fetchMigrating } from "../api/client";
import { useChain } from "../contexts/ChainContext";
import { isEvmChain } from "../lib/chains";
import type { TokenEvent } from "../types";
import { byProgress, useLaunchpadBoard } from "./useLaunchpadBoard";

/**
 * On the EVM chains, how full a curve on the `new` board must be to join the
 * Migrating column. The API's `graduating` board starts at 50%, which curves
 * there seldom reach before they graduate (Ethereum's moto.fun, Livo and
 * UniswapCCA, Base's Flap), so the column was empty where other terminals
 * show the fullest live curves.
 */
export const EVM_MIGRATING_MIN_PERCENT = 10;

const almostBonded = (t: TokenEvent) =>
  !t.graduated && !t.migrated_at && (t.graduationPercent ?? 0) >= EVM_MIGRATING_MIN_PERCENT;

/**
 * The launchpad `graduating` board: curves 50–100% full and traded in the last
 * 30 minutes, fullest first, live. A row leaves on the API's `remove` (it
 * graduated, went quiet, or its curve fell back). On the EVM chains the
 * column also takes the `new` board's curves at `EVM_MIGRATING_MIN_PERCENT`
 * or more, fullest first like the rest.
 */
export function useMigratingStream(filters?: ColumnFilters) {
  const { chainId } = useChain();
  const extra = useMemo(
    () => (isEvmChain(chainId) ? { event: "deploy" as const, fetch: fetchDeploys, admit: almostBonded } : null),
    [chainId],
  );
  return useLaunchpadBoard({ event: "migrating", fetch: fetchMigrating, order: byProgress, filters, extra });
}
