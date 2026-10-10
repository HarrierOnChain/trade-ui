"use client";
import type { ColumnFilters } from "../lib/tokenFilters";
import { fetchMigrations } from "../api/client";
import { byGraduated, useLaunchpadBoard } from "./useLaunchpadBoard";

/** The launchpad `graduated` board: latest graduations first, live. */
export function useMigrationStream(filters?: ColumnFilters) {
  return useLaunchpadBoard({ event: "migration", fetch: fetchMigrations, order: byGraduated, filters });
}
