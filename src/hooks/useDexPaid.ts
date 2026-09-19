"use client";

// Per-mint "DEX Paid" status — DexScreener "Enhanced Token Info" badge.
//
// Two sources, one piece of state:
//   1. REST seed via `fetchPublicMetadata` (which now exposes `dexPaid` from
//      `/api/sol/tokens/metadata/{mint}`). Sticky cached, single-flight.
//   2. Live WS push on the `dex_paid` event: when the streaming bridge sees
//      this mint appear in DexScreener's profile feed, flip to `true` and
//      capture the profile URL.
//
// `undefined` means "we don't know yet" (the backend kicks an on-demand
// check; the next REST cycle will resolve it).

import { useEffect, useState } from "react";
import { RazeWebSocket } from "../api/websocket";
import { fetchPublicMetadata } from "../api/metadata";
import { CHAIN_CHANGED_EVENT } from "../lib/chains";

export interface DexPaidState {
  /** `true`/`false` once resolved; `undefined` while unknown. */
  dexPaid: boolean | undefined;
  /** DexScreener profile URL (set when the live WS event delivers one). */
  dexscreenerUrl: string | undefined;
  /** Monotonically-increasing timestamp set ONLY when the live WS feed
   *  transitions us from non-true → true. The REST seed never sets it, so
   *  opening a token page that was already paid stays quiet — consumers
   *  watch this for "just got paid right now" celebrations. */
  liveFlipAt: number | null;
}

const EMPTY: DexPaidState = {
  dexPaid: undefined,
  dexscreenerUrl: undefined,
  liveFlipAt: null,
};

export function useDexPaid(mint: string | null | undefined): DexPaidState {
  const [state, setState] = useState<DexPaidState>(EMPTY);

  useEffect(() => {
    setState(EMPTY);
    if (!mint) return;

    let cancelled = false;

    // 1. Seed from REST. fetchPublicMetadata is cache+single-flight, so
    //    this collapses with whatever TokenHeader's own fallback fetch
    //    already does — no double round-trip. The REST path NEVER sets
    //    `liveFlipAt` (we don't celebrate already-known paid tokens).
    void fetchPublicMetadata(mint).then((meta) => {
      if (cancelled) return;
      setState((prev) => ({
        // Don't downgrade a `true` we may have already received via WS.
        dexPaid: prev.dexPaid === true ? true : meta.dexPaid,
        dexscreenerUrl: prev.dexscreenerUrl ?? meta.dexscreenerUrl,
        liveFlipAt: prev.liveFlipAt,
      }));
    });

    // 2. Subscribe to the live WS feed for this mint. The streaming bridge
    //    emits one `dex_paid` event per (mint, profile) so when one lands
    //    matching us, flip to `true` AND stamp `liveFlipAt` if this is the
    //    transition (so the celebration overlay fires exactly once).
    const ws = RazeWebSocket.getInstance();
    ws.subscribeToken(mint);

    const handler = (msg: Record<string, unknown>) => {
      if (String(msg.mint ?? "") !== mint) return;
      const paid = msg.paid;
      const url = typeof msg.url === "string" ? msg.url : undefined;
      setState((prev) => {
        // Monotonic: never demote true→false from a stray frame.
        const nextPaid =
          prev.dexPaid === true ? true : paid === false ? false : true;
        // Stamp the celebration trigger only on a transition into `true`
        // delivered by the WS (not a re-broadcast that doesn't change us).
        const transitioned = prev.dexPaid !== true && nextPaid === true;
        return {
          dexPaid: nextPaid,
          dexscreenerUrl: url ?? prev.dexscreenerUrl,
          liveFlipAt: transitioned ? Date.now() : prev.liveFlipAt,
        };
      });
    };
    const unsub = ws.on("dex_paid", handler);

    // Chain change unwires the WS sub via the websocket facade; we just
    // re-mount this hook (the parent will too).
    const onChain = () => setState(EMPTY);
    if (typeof window !== "undefined") {
      window.addEventListener(CHAIN_CHANGED_EVENT, onChain);
    }

    return () => {
      cancelled = true;
      unsub();
      ws.unsubscribeToken(mint);
      if (typeof window !== "undefined") {
        window.removeEventListener(CHAIN_CHANGED_EVENT, onChain);
      }
    };
  }, [mint]);

  return state;
}
