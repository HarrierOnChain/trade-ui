"use client";

// Per-mint live migration trigger — fires once when a token the user is
// currently viewing migrates over the WS (pump.fun → PumpSwap).
// Mirrors `useDexPaid`'s `liveFlipAt` contract.
//
// REST baseline (`alreadyMigrated`) is supplied by the parent — it already
// knows from `useTokenInfo` whether `token.migrated_at` was non-null at
// mount or whether the quote is a migrated pool. Passing it in saves a
// duplicate REST round-trip and keeps the hook stateless about identity.
//
// Streaming emits payload shape:
//   {
//     type: "migration",
//     data: { platform, mint, pool, pool_dex, slot, quote_mint },
//     timestamp, signature, priceInfo
//   }
// Identifying fields can also be flat on the top-level message — we accept
// either, same as normalize.ts.

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
    ws.subscribeToken(mint);

    const handler = (msg: Record<string, unknown>) => {
      // Same extractor shape as the backend's `matches()` and normalize.ts
      // — pump.fun streaming nests identifying fields under `data`, some
      // pipelines flatten.
      const data =
        msg.data && typeof msg.data === "object" && !Array.isArray(msg.data)
          ? (msg.data as Record<string, unknown>)
          : msg;
      const m = String(data.mint ?? msg.mint ?? "");
      if (m !== mint) return;
      if (seenMigrated.current) return;
      seenMigrated.current = true;

      const poolDex =
        (typeof data.pool_dex === "string" && data.pool_dex) ||
        (typeof (data as { poolDex?: unknown }).poolDex === "string" &&
          (data as { poolDex: string }).poolDex) ||
        null;
      const pool = typeof data.pool === "string" && data.pool ? data.pool : null;

      setState({
        liveMigratedAt: Date.now(),
        poolDex: poolDex || null,
        pool: pool || null,
      });
    };
    const unsub = ws.on("migration", handler);

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
      ws.unsubscribeToken(mint);
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
