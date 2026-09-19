"use client";

// Per-token "views": the number of streaming clients subscribed to the mint
// (useRazeListeners, by mint). `total` mirrors `raze` and is null until the
// first signal arrives, so the FE can hide the stat until then.

import { useRazeListeners } from "./useRazeListeners";

export interface TokenViews {
  raze: number | null;
  total: number | null;
}

export function useTokenViews(mint: string | null | undefined): TokenViews {
  const raze = useRazeListeners(mint);
  return { raze, total: raze };
}
