"use client";
import { useEffect, useState } from "react";
import { fetchChainSentiment } from "../api/client";
import type { ChainSentiment } from "../types";

export function useChainSentiment(pollMs = 60_000) {
  const [sentiment, setSentiment] = useState<ChainSentiment | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetchChainSentiment();
        if (!cancelled) setSentiment(res);
      } catch {
        /* ignore */
      }
    }
    load();
    const id = setInterval(load, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollMs]);

  return sentiment;
}
