"use client";

// Raze's own per-token viewer signal: the number of streaming clients
// subscribed to the token mint, pushed by streaming's raze_listeners emitter
// (~every 4s, routed by mint). One venue of the aggregated views count.
//
// NB: this is the STREAMING-level subscriber count (regional app-backends /
// direct API clients / services behind the ref-counted wire), not a per-browser
// number — see streaming `ws::raze_listeners`.

import { useEffect, useState } from "react";
import { RazeWebSocket } from "../api/websocket";
import { CHAIN_CHANGED_EVENT } from "../lib/chains";

export function useRazeListeners(mint: string | null | undefined): number | null {
  const [listeners, setListeners] = useState<number | null>(null);

  useEffect(() => {
    setListeners(null);
    if (!mint) return;

    // No listener-count channel on this API: nothing to subscribe, and the
    // count stays null (hidden) unless something dispatches it.
    const ws = RazeWebSocket.getInstance();

    const handler = (msg: Record<string, unknown>) => {
      if (String(msg.mint ?? msg.address ?? "") !== mint) return;
      const n =
        typeof msg.listeners === "number"
          ? msg.listeners
          : Number.parseInt(String(msg.listeners ?? ""), 10);
      if (Number.isFinite(n)) setListeners(n);
    };
    const unsub = ws.on("raze_listeners", handler);

    const onChain = () => setListeners(null);
    if (typeof window !== "undefined") {
      window.addEventListener(CHAIN_CHANGED_EVENT, onChain);
    }

    return () => {
      unsub();
      if (typeof window !== "undefined") {
        window.removeEventListener(CHAIN_CHANGED_EVENT, onChain);
      }
    };
  }, [mint]);

  return listeners;
}
