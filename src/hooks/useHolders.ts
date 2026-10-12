"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { fetchHolders } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import type { Holder } from "../types";

/** Extension of Holder that lets the table flag wallets new to the list. */
export type LiveHolder = Holder & { isNew?: boolean };

/**
 * A token's 100 largest holders, as the API gives them (shares included:
 * null when not measured). One REST read primes the list; the `holders`
 * channel then replaces it whenever the API's list changes (at most every
 * 10 s while the token trades). `newHoldersCount` counts the wallets that
 * entered the list since the mint was loaded.
 */
export function useHolders(mint: string | null) {
  const [holders, setHolders] = useState<LiveHolder[]>([]);
  const [currentPriceSol, setCurrentPriceSol] = useState(0);
  const [supply, setSupply] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newHoldersCount, setNewHoldersCount] = useState(0);
  // A list the channel sent is newer than any REST answer still in flight.
  const liveRef = useRef(false);
  // The wallets of the last list, to flag the ones a new list brings.
  const knownRef = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    if (!mint) return;
    try {
      const res = await fetchHolders(mint, 100);
      setSupply(res.supply ?? null);
      setCurrentPriceSol(res.currentPriceSol);
      if (!liveRef.current) {
        setHolders(res.holders);
        knownRef.current = new Set(res.holders.map((h) => h.address));
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
    setNewHoldersCount(0);
    if (!mint) {
      setHolders([]);
      setCurrentPriceSol(0);
      setSupply(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setHolders([]);
    load();
  }, [load, mint]);

  useEffect(() => {
    if (!mint) return;
    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribeToken(mint, ["holders"]);
    const off = ws.on("holders", (msg) => {
      if (msg.tokenMint !== mint || !Array.isArray(msg.rows)) return;
      const rows = msg.rows as Holder[];
      const known = knownRef.current;
      let added = 0;
      const list: LiveHolder[] = rows.map((h) => {
        if (!known || known.has(h.address)) return h;
        added += 1;
        return { ...h, isNew: true };
      });
      knownRef.current = new Set(rows.map((h) => h.address));
      liveRef.current = true;
      setHolders(list);
      setLoading(false);
      if (added) setNewHoldersCount((c) => c + added);
    });
    return () => {
      off();
      ws.unsubscribeToken(mint, ["holders"]);
    };
  }, [mint]);

  return { holders, currentPriceSol, supply, loading, error, refresh: load, newHoldersCount };
}
