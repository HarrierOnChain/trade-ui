"use client";
import { useEffect, useRef, useState } from "react";
import { fetchDeploys } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import { toArray, normalizeTokenEvent, normalizeRestToken } from "../api/normalize";
import { friendlyFetchError } from "../api/chainError";
import { useChain } from "../contexts/ChainContext";
import { useClientPageVisible } from "../contexts/ClientPageVisibility";
import { mergeDexLabel } from "../lib/format";
import { reconcileSnapshot } from "../lib/streamMerge";
import { useTokenEnrichment } from "./useTokenEnrichment";
import { useMetaEnrichment } from "./useMetaEnrichment";
import type { TokenEvent } from "../types";

const MAX = 20;
/** REST fallback when wire/live drops — mirrors useMigratingStream. */
const POLL_MS = 15_000;

const ts = (t: TokenEvent) => Date.parse(t.created_at) || 0;

function snapshotFromRest(res: unknown): TokenEvent[] {
  const seen = new Set<string>();
  return toArray<Record<string, unknown>>(res)
    .map(normalizeRestToken)
    .filter((t) => {
      if (!t.mint_address || seen.has(t.mint_address)) return false;
      seen.add(t.mint_address);
      return true;
    })
    .sort((a, b) => ts(b) - ts(a));
}

function insertByCreatedAt(list: TokenEvent[], token: TokenEvent, max: number): TokenEvent[] {
  const tt = ts(token);
  let i = 0;
  while (i < list.length && ts(list[i]) >= tt) i++;
  const next = list.slice();
  next.splice(i, 0, token);
  return next.slice(0, max);
}

export function useDeployStream(platform?: string) {
  const { chainId } = useChain();
  const pageVisible = useClientPageVisible();
  const [tokens, setTokens] = useState<TokenEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrichKey, setEnrichKey] = useState(0);
  const renderedRef = useRef(new Set<string>());
  const platformRef = useRef(platform);
  platformRef.current = platform;

  // REST snapshot + periodic refresh — re-run when platform or chain changes.
  useEffect(() => {
    if (!pageVisible) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    renderedRef.current.clear();
    setTokens([]);

    const load = (initial: boolean) => {
      fetchDeploys(MAX, platform)
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
          setTokens((prev) => reconcileSnapshot(prev, incoming, MAX, ts));
          if (hasNew) setEnrichKey((k) => k + 1);
          setError(null);
        })
        .catch((e) => {
          // Keep showing prior rows on poll failure; only blank-state the
          // column when the initial snapshot fails.
          if (!cancelled && (initial || renderedRef.current.size === 0)) {
            setError(friendlyFetchError(e));
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

  useEffect(() => {
    if (!pageVisible) return;
    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribe(["deploy"]);

    const unsub = ws.on("deploy", (msg) => {
      const token = normalizeTokenEvent(msg as unknown as Record<string, unknown>);
      if (!token) return;

      if (platformRef.current && token.dex &&
          !platformRef.current.toLowerCase().split(",").some(
            (p) => p.trim() === token.dex.toLowerCase()
          )) return;

      const isNew = !renderedRef.current.has(token.mint_address);
      renderedRef.current.add(token.mint_address);

      setTokens((prev) => {
        if (!isNew) {
          return prev.map((t) => {
            if (t.mint_address !== token.mint_address) return t;
            return {
              ...t,
              ...token,
              image:  token.image  || t.image,
              name:   token.name   || t.name,
              symbol: token.symbol || t.symbol,
              dex:    mergeDexLabel(t.dex, token.dex),
            };
          });
        }
        return insertByCreatedAt(prev, { ...token, isNew: true }, MAX);
      });
    });

    return () => {
      unsub();
      ws.unsubscribe(["deploy"]);
    };
  }, [chainId, pageVisible]);

  useTokenEnrichment(tokens, setTokens, 20, enrichKey);
  useMetaEnrichment(tokens, setTokens, 20, enrichKey);

  return { tokens, loading: pageVisible ? loading : false, error };
}
