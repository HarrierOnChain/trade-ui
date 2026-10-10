"use client";
import type { ColumnFilters } from "../lib/tokenFilters";
import { fetchDeploys } from "../api/client";
import { byCreated, useLaunchpadBoard } from "./useLaunchpadBoard";

/** The launchpad `new` board: latest launches, newest first, live. */
export function useDeployStream(filters?: ColumnFilters) {
  return useLaunchpadBoard({ event: "deploy", fetch: fetchDeploys, order: byCreated, filters });
}
