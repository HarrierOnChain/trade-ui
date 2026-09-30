"use client";
import { fetchMigrations } from "../api/client";
import { byGraduated, useLaunchpadBoard } from "./useLaunchpadBoard";

/** The launchpad `graduated` board: latest graduations first, live. */
export function useMigrationStream(platform?: string) {
  return useLaunchpadBoard({ event: "migration", fetch: fetchMigrations, order: byGraduated, platform });
}
