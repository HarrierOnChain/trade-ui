"use client";
import { useEffect, useRef, useState } from "react";
import { fetchMigrations } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import { toArray, normalizeTokenEvent, normalizeRestToken } from "../api/normalize";
import { useChain } from "../contexts/ChainContext";
import { useClientPageVisible } from "../contexts/ClientPageVisibility";
import { applyLiveFrame, reconcileSnapshot } from "../lib/streamMerge";
import { useTokenEnrichment } from "./useTokenEnrichment";
import { useMetaEnrichment } from "./useMetaEnrichment";
import type { TokenEvent } from "../types";

const MAX = 20;
const POLL_MS = 15_000;

// The migration column ranks by migration recency (history ORDER BY m.time),
// not token birth. migrated_at is present on both REST (`migratedAt`) and WS
// rows; fall back to created_at only if it's ever missing.
const tsMigrated = (t: TokenEvent) =>
  (t.migrated_at ? Date.parse(t.migrated_at) : 0) || Date.parse(t.created_at) || 0;

function snapshotFromRest(res: unknown): TokenEvent[] {
  const seen = new Set<string>();
  return toArray<Record<string, unknown>>(res)
    .map(normalizeRestToken)
    .filter((t) => {
      if (!t.mint_address || seen.has(t.mint_address)) return false;
      seen.add(t.mint_address);
      return true;
    });
}

export function useMigrationStream(platform?: string) {
  const { chainId } = useChain();
  const pageVisible = useClientPageVisible();
  const [tokens, setTokens] = useState<TokenEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrichKey, setEnrichKey] = useState(0);
  const renderedRef = useRef(new Set<string>());
  const platformRef = useRef(platform);
  platformRef.current = platform;

  useEffect(() => {
    if (!pageVisible) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    renderedRef.current.clear();
    setTokens([]);

    const load = (initial: boolean) => {
      fetchMigrations(MAX, platform)
        .then((res) => {
          if (cancelled) return;
          const incoming = snapshotFromRest(res);
          // A genuinely-new mint (vs everything seen so far) triggers a one-shot
          // enrich-key bump; unchanged rows keep their enriched data + identity.
          const hasNew = incoming.some(
            (t) => t.mint_address && !renderedRef.current.has(t.mint_address),
          );
          incoming.forEach((t) => renderedRef.current.add(t.mint_address));
          // Diff-merge, don't replace the array wholesale: a raw
          // setTokens(snapshot) blanks enriched stats/images every poll → the
          // column visibly "refreshes". See lib/streamMerge.
          setTokens((prev) => reconcileSnapshot(prev, incoming, MAX, tsMigrated));
          if (hasNew) setEnrichKey((k) => k + 1);
          setError(null);
        })
        .catch((e) => {
          if (!cancelled && (initial || renderedRef.current.size === 0)) {
            setError(String(e));
          }
        })
        .finally(() => { if (!cancelled && initial) setLoading(false); });
    };

    load(true);
    const pollId = setInterval(() => load(false), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(pollId);
    };
  }, [platform, chainId, pageVisible]);

  // Real-time WebSocket
  useEffect(() => {
    if (!pageVisible) return;
    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribe(["migration"]);

    const unsub = ws.on("migration", (msg) => {
      const token = normalizeTokenEvent(
        msg as unknown as Record<string, unknown>,
        true // isMigration
      );
      if (!token) return;

      // Client-side platform filter for WS events
      if (platformRef.current && token.dex &&
          !platformRef.current.toLowerCase().split(",").some(
            (p) => p.trim() === token.dex.toLowerCase()
          )) return;

      const isNew = !renderedRef.current.has(token.mint_address);
      renderedRef.current.add(token.mint_address);

      // A first sighting with no migration time yet (a completion frame
      // without completedAt) is placed at its arrival; a merge never takes it.
      const insertAs = {
        ...token,
        isNew,
        migrated_at: token.migrated_at ?? new Date().toISOString(),
      };
      setTokens((prev) => applyLiveFrame(prev, token, tsMigrated, MAX, insertAs));
    });

    return () => {
      unsub();
      ws.unsubscribe(["migration"]);
    };
  }, [chainId, pageVisible]);

  useTokenEnrichment(tokens, setTokens, 20, enrichKey);
  useMetaEnrichment(tokens, setTokens, 20, enrichKey);

  return { tokens, loading: pageVisible ? loading : false, error };
}
