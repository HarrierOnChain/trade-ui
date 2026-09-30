"use client";

// Per-mint live migration trigger — fires once when a token the user is
// currently viewing graduates from its launchpad (pump.fun → PumpSwap, …).
// Mirrors `useDexPaid`'s `liveFlipAt` contract.
//
// REST baseline (`alreadyMigrated`) is supplied by the parent — it already
// knows from `useTokenInfo` whether `token.migrated_at` was non-null at
// mount. Live: the API's `token` channel re-sends the Token (with
// `launchpad.graduated`) on subscribe and every ≤15 s while it trades, and the
// `graduated` launchpad board adds the token the moment it moves. The first
// `token` frame is a baseline too, so an already-graduated token never fires.

import { useEffect, useRef, useState } from "react";
import { RazeWebSocket } from "../api/websocket";
import { CHAIN_CHANGED_EVENT } from "../lib/chains";

export interface MigrationLiveState {
  /** Monotonic ms stamp set ONLY on the first WS migration event for this
   *  mint after baseline=false. Drives the celebration overlay. */
  liveMigratedAt: number | null;
  /** Pool DEX the migration landed on, e.g. "PumpSwap". */
  poolDex: string | null;
  /** New pool address from the live event. */
  pool: string | null;
}

const EMPTY: MigrationLiveState = { liveMigratedAt: null, poolDex: null, pool: null };

export function useMigration(
  mint: string | null | undefined,
  alreadyMigrated: boolean,
): MigrationLiveState {
  const [state, setState] = useState<MigrationLiveState>(EMPTY);

  // Internal "seen migrated" baseline. Tracks both the REST-supplied
  // `alreadyMigrated` and any WS event we've already fired on, so a second
  // migration frame for the same mint (e.g. Pumpfun's `Complete` + `Migrate`
  // pair landing 1–2s apart) doesn't double-fire the overlay.
  const seenMigrated = useRef(alreadyMigrated);
  useEffect(() => {
    if (alreadyMigrated) seenMigrated.current = true;
  }, [alreadyMigrated]);

  useEffect(() => {
    setState(EMPTY);
    seenMigrated.current = alreadyMigrated;
    if (!mint) return;

    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribeToken(mint, ["token"], { sse: true });
    ws.subscribe(["migration"]);
    let baselineSeen = false;

    const fire = (pool: unknown, poolDex: unknown) => {
      if (seenMigrated.current) return;
      seenMigrated.current = true;
      setState({
        liveMigratedAt: Date.now(),
        poolDex: typeof poolDex === "string" && poolDex ? poolDex : null,
        pool: typeof pool === "string" && pool ? pool : null,
      });
    };

    const onToken = (msg: Record<string, unknown>) => {
      if (msg.tokenMint !== mint) return;
      const raw = (msg.raw ?? {}) as Record<string, unknown>;
      const lp = (raw.launchpad ?? null) as Record<string, unknown> | null;
      const graduated = lp?.graduated === true;
      if (!baselineSeen) {
        baselineSeen = true;
        if (graduated) seenMigrated.current = true;
        return;
      }
      if (!graduated) return;
      const pool = (raw.pool ?? null) as Record<string, unknown> | null;
      fire(lp?.graduatedPool, pool?.dex);
    };

    // The graduated board's `add` is the earliest word of a graduation.
    const onBoard = (msg: Record<string, unknown>) => {
      if (msg.kind !== "add" || msg.mint_address !== mint) return;
      fire(null, msg.dex);
    };

    const offToken = ws.on("token", onToken);
    const offBoard = ws.on("migration", onBoard);
    const unsub = () => { offToken(); offBoard(); };

    // Chain change — reset; the WS facade tears subs down for us.
    const onChain = () => {
      setState(EMPTY);
      seenMigrated.current = false;
    };
    if (typeof window !== "undefined") {
      window.addEventListener(CHAIN_CHANGED_EVENT, onChain);
    }

    return () => {
      unsub();
      ws.unsubscribeToken(mint, ["token"], { sse: true });
      ws.unsubscribe(["migration"]);
      if (typeof window !== "undefined") {
        window.removeEventListener(CHAIN_CHANGED_EVENT, onChain);
      }
    };
    // alreadyMigrated intentionally omitted from deps — its current value is
    // read fresh inside the effect on mount, and subsequent flips are mirrored
    // into the ref by the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint]);

  return state;
}
