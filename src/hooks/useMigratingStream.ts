"use client";
import type { ColumnFilters } from "../lib/tokenFilters";
import { fetchMigrating } from "../api/client";
import { byProgress, useLaunchpadBoard } from "./useLaunchpadBoard";

/**
 * The launchpad `graduating` board: curves 50–100% full and traded in the last
 * 30 minutes, fullest first, live. A row leaves on the API's `remove` (it
 * graduated, went quiet, or its curve fell back) — no client-side threshold.
 */
export function useMigratingStream(filters?: ColumnFilters) {
  return useLaunchpadBoard({ event: "migrating", fetch: fetchMigrating, order: byProgress, filters });
}
