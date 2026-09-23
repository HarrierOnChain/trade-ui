"use client";
import { useEffect, useRef, useState } from "react";
import { fetchMigrating } from "../api/client";
import { toArray, normalizeRestToken, normalizeTokenEvent } from "../api/normalize";
import { RazeWebSocket } from "../api/websocket";
import { mergeLiveFrame } from "../lib/streamMerge";
import { useChain } from "../contexts/ChainContext";
import { useClientPageVisible } from "../contexts/ClientPageVisibility";
import { mergeDexLabel } from "../lib/format";
import { useTokenEnrichment } from "./useTokenEnrichment";
import { useMetaEnrichment } from "./useMetaEnrichment";
import type { TokenEvent } from "../types";

const MAX = 20;
// The board streams on the `migrating` channel (join, quote moves, graduation).
// The poll only reconciles membership, like the deploy/migration columns.
const POLL_INTERVAL = 15_000;
// Mirrors the API: a row under this progress has left the board.
const LEAVE_PROGRESS = 10;

// Same ranking as the REST board: furthest up the curve first, then newest.
function byProgress(list: TokenEvent[]): TokenEvent[] {
  return list.slice().sort((a, b) =>
    (b.graduationPercent ?? 0) - (a.graduationPercent ?? 0)
    || (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
}

// Fields the migrating snapshot is the authoritative source for. Anything
// outside this set (marketCap, volume24h, holders, …) comes from
// useTokenEnrichment and must NOT be wiped on each poll.
const SNAPSHOT_KEYS: Array<keyof TokenEvent> = [
  "mint_address", "signer", "dex", "name", "symbol", "uri", "slot",
  "image", "creatorBuySol", "creatorBuyPrice", "creatorBuyTokens",
  "lastPrice", "created_at",
  // The quote and the curve: nothing else ever refreshes them on a row.
  "marketCap", "priceChange", "graduationPercent",
];

function rowsEqual(a: TokenEvent, b: TokenEvent): boolean {
  for (const k of SNAPSHOT_KEYS) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function mergeKeepingEnriched(prev: TokenEvent, next: TokenEvent): TokenEvent {
  const merged: TokenEvent = { ...prev };
  const m = merged as unknown as Record<string, unknown>;
  const n = next as unknown as Record<string, unknown>;
  for (const k of SNAPSHOT_KEYS) {
    const v = n[k as string];
    if (v === undefined || v === null || v === "") continue;
    m[k as string] = v;
  }
  merged.image    = next.image    ?? prev.image;
  merged.twitter  = next.twitter  ?? prev.twitter;
  merged.website  = next.website  ?? prev.website;
  merged.telegram = next.telegram ?? prev.telegram;
  // Keep a pump-family launchpad (Mayhem) label vs a pumpfun/pumpswap snapshot.
  merged.dex      = mergeDexLabel(prev.dex, next.dex);
  return merged;
}

export function useMigratingStream(platform?: string) {
  const { chainId } = useChain();
  const pageVisible = useClientPageVisible();
  const [tokens, setTokens] = useState<TokenEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrichKey, setEnrichKey] = useState(0);
  const enrichMintKeyRef = useRef("");
  const platformRef = useRef(platform);
  platformRef.current = platform;

  // Diff-merge the latest snapshot into state so unchanged rows keep their
  // reference (React.memo bails) and removed mints disappear.
  const apply = (raw: Array<Record<string, unknown>>) => {
    const wanted = platform?.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
    const incoming = raw
      .map((row) => {
        const t = normalizeRestToken(row);
        const lap = row.last_avg_price ?? row.lastAvgPrice;
        if (typeof lap === "number" && isFinite(lap) && lap > 0) t.lastPrice = lap;
        // The migrating snapshot carries deploy_time_ms (epoch ms), not the
        // ISO created_at that normalizeRestToken expects, so the row's age
        // column would otherwise be blank. Map it explicitly.
        const dtMs = row.deploy_time_ms ?? row.deployTimeMs;
        if (typeof dtMs === "number" && isFinite(dtMs) && dtMs > 0) {
          t.created_at = new Date(dtMs).toISOString();
        }
        return t;
      })
      .filter((t) => {
        if (!t.mint_address) return false;
        if (wanted && wanted.length && t.dex) {
          const p = t.dex.toLowerCase();
          if (!wanted.includes(p)) return false;
        }
        return true;
      });

    setTokens((prev) => {
      const prevByMint = new Map(prev.map((t) => [t.mint_address, t]));
      const seen = new Set<string>();
      const nextList: TokenEvent[] = [];

      // Snapshot order is the ranking (closest to migration first). Keep
      // enriched fields / object identity; drop mints the snapshot dropped.
      for (const t of incoming) {
        if (!t.mint_address || seen.has(t.mint_address)) continue;
        seen.add(t.mint_address);
        const old = prevByMint.get(t.mint_address);
        if (!old) {
          nextList.push({ ...t, isNew: true });
          continue;
        }
        const merged = mergeKeepingEnriched(old, t);
        nextList.push(rowsEqual(merged, old) ? old : merged);
      }
      if (
        nextList.length === prev.length &&
        nextList.every((t, i) => t === prev[i])
      ) {
        return prev;
      }
      return nextList;
    });

    if (incoming.length > 0) {
      const key = incoming.map((t) => t.mint_address).slice(0, 20).join(",");
      if (key !== enrichMintKeyRef.current) {
        enrichMintKeyRef.current = key;
        setEnrichKey((k) => k + 1);
      }
    }
  };

  useEffect(() => {
    if (!pageVisible) {
      setTokens([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    let hadRows = false;
    // Another chain's (or platform's) board must not sort in with this one's
    // replay while the first read is in flight.
    setTokens([]);
    setLoading(true);
    enrichMintKeyRef.current = "";

    const load = (initial: boolean) => {
      fetchMigrating(MAX, platform)
        .then((res) => {
          if (cancelled) return;
          apply(toArray<Record<string, unknown>>(res));
          hadRows = true;
          setError(null);
        })
        .catch((e) => {
          if (!cancelled && (initial || !hadRows)) setError(String(e));
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    };

    load(true);
    const id = setInterval(() => load(false), POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, chainId, pageVisible]);

  // Live board: a row joins when its curve crosses the API's floor, moves with
  // its quote, and leaves on graduation (or when its curve falls back).
  useEffect(() => {
    if (!pageVisible) return;
    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribe(["migrating"]);
    const unsub = ws.on("migrating", (msg) => {
      const token = normalizeTokenEvent(msg as unknown as Record<string, unknown>);
      if (!token) return;
      const pct = token.graduationPercent;
      const leaving = msg.completed === true || (pct != null && (pct >= 100 || pct < LEAVE_PROGRESS));
      // Before the platform filter: dropping a row is always right, and a row
      // that got in under another label must still be able to leave.
      if (leaving) {
        setTokens((prev) => {
          const i = prev.findIndex((t) => t.mint_address === token.mint_address);
          return i < 0 ? prev : prev.filter((_, j) => j !== i);
        });
        return;
      }
      const wanted = platformRef.current?.toLowerCase().split(",").map((p) => p.trim()).filter(Boolean);
      if (wanted?.length && token.dex && !wanted.includes(token.dex.toLowerCase())) return;
      setTokens((prev) => {
        const i = prev.findIndex((t) => t.mint_address === token.mint_address);
        if (i >= 0) {
          const merged = mergeLiveFrame(prev[i], token);
          const cur = prev[i] as unknown as Record<string, unknown>;
          const m = merged as unknown as Record<string, unknown>;
          if (Object.keys(m).every((k) => m[k] === cur[k])) return prev;
          const next = prev.slice();
          next[i] = merged;
          const sorted = byProgress(next);
          return sorted.every((t, j) => t === next[j]) ? next : sorted;
        }
        const next = byProgress([...prev, { ...token, isNew: true }]).slice(0, MAX);
        return next.some((t) => t.mint_address === token.mint_address) ? next : prev;
      });
    });
    return () => {
      unsub();
      ws.unsubscribe(["migrating"]);
    };
  }, [chainId, pageVisible]);

  useTokenEnrichment(tokens, setTokens, 20, enrichKey);
  useMetaEnrichment(tokens, setTokens, 20, enrichKey);

  return { tokens, loading: pageVisible ? loading : false, error };
}
