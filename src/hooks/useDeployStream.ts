"use client";
import { fetchDeploys } from "../api/client";
import { byCreated, useLaunchpadBoard } from "./useLaunchpadBoard";

/** The launchpad `new` board: latest launches, newest first, live. */
export function useDeployStream(platform?: string) {
  return useLaunchpadBoard({ event: "deploy", fetch: fetchDeploys, order: byCreated, platform });
}
