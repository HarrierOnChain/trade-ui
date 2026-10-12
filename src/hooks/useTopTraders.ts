"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { fetchTopTraders } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import type { TopTrader } from "../types";

const MAX_TRADERS = 100;

export type LiveTopTrader = TopTrader & { isNew?: boolean };

/**
 * A token's top traders, as the API ranks them (its PnL). One REST read
 * primes the list; the `traders` channel then replaces it whenever the API's
 * list changes (at most every 15 s while the token trades).
 * `newTradersCount` counts the wallets that entered the list since the mint
 * was loaded. `_solPriceUsd` is kept for callers; the rows are the API's.
 */
export function useTopTraders(mint: string | null, _solPriceUsd: number = 0) {
  const [traders, setTraders] = useState<LiveTopTrader[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTradersCount, setNewTradersCount] = useState(0);
  // A list the channel sent is newer than any REST answer still in flight.
  const liveRef = useRef(false);
  const knownRef = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    if (!mint) return;
    try {
      const res = await fetchTopTraders(mint, MAX_TRADERS);
      if (!liveRef.current) {
        setTraders(res.data);
        knownRef.current = new Set(res.data.map((t) => t.trader));
      }
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [mint]);

  useEffect(() => {
    liveRef.current = false;
    knownRef.current = null;
    setNewTradersCount(0);
    if (!mint) {
      setTraders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setTraders([]);
    load();
  }, [load, mint]);

  useEffect(() => {
    if (!mint) return;
    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribeToken(mint, ["traders"]);
    const off = ws.on("traders", (msg) => {
      if (msg.tokenMint !== mint || !Array.isArray(msg.rows)) return;
      const rows = (msg.rows as TopTrader[]).slice(0, MAX_TRADERS);
      const known = knownRef.current;
      let added = 0;
      const list: LiveTopTrader[] = rows.map((t) => {
        if (!known || known.has(t.trader)) return t;
        added += 1;
        return { ...t, isNew: true };
      });
      knownRef.current = new Set(rows.map((t) => t.trader));
      liveRef.current = true;
      setTraders(list);
      setLoading(false);
      if (added) setNewTradersCount((c) => c + added);
    });
    return () => {
      off();
      ws.unsubscribeToken(mint, ["traders"]);
    };
  }, [mint]);

  return { traders, loading, error, refresh: load, newTradersCount };
}
