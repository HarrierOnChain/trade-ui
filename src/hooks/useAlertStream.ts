"use client";
import { useEffect, useRef, useState } from "react";
import { RazeWebSocket } from "../api/websocket";
import { fetchTrending } from "../api/client";
import { normalizeRestToken, toArray } from "../api/normalize";
import { useTokenEnrichment } from "./useTokenEnrichment";
import type { TokenEvent, TrendingPeriod, TrendingToken } from "../types";

const MAX = 20;

function normalizeAlert(msg: Record<string, unknown>): TokenEvent | null {
  const data =
    msg.data && typeof msg.data === "object" && !Array.isArray(msg.data)
      ? (msg.data as Record<string, unknown>)
      : msg;

  const mint = String(data.mint ?? data.address ?? msg.mint ?? msg.address ?? "");
  if (!mint) return null;

  return {
    mint_address:  mint,
    name:          String(data.name   ?? ""),
    symbol:        String(data.symbol ?? ""),
    dex:           String(data.dex ?? data.platform ?? msg.dex ?? msg.platform ?? ""),
    image:         (data.image ?? data.imageUri ?? null) as string | null,
    created_at:    String(msg.timestamp ?? new Date().toISOString()),
    marketCap:     data.totalVolumeSol != null ? Number(data.totalVolumeSol) : undefined,
    creatorBuySol:   (data.creatorBuySol   ?? data.creator_buy_sol   ?? data.devBuySol      ?? data.dev_buy_sol)       as number | undefined,
    creatorBuyPrice: (data.creatorBuyPrice ?? data.creator_buy_price ?? data.devBuyAvgPrice ?? data.dev_buy_avg_price ?? data.devBuyPrice ?? data.dev_buy_price) as number | undefined,
    creatorBuyTokens: (data.creatorBuyTokens ?? data.creator_buy_tokens ?? data.devBuyTokens ?? data.dev_buy_tokens) as number | undefined,
    signer:        (data.signer ?? data.creator ?? msg.signer ?? msg.creator ?? undefined) as string | undefined,
  };
}

function alertRestToToken(t: TrendingToken): TokenEvent {
  return normalizeRestToken(t as unknown as Record<string, unknown>);
}

function matchesPlatform(dex: string, platform?: string): boolean {
  if (!platform) return true;
  if (!dex) return false;
  return platform.toLowerCase().split(",").some(
    (p) => p.trim() === dex.toLowerCase()
  );
}

export function useAlertStream(platform?: string, period: TrendingPeriod = "recent") {
  const [tokens, setTokens] = useState<TokenEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrichKey, setEnrichKey] = useState(0);
  const renderedRef = useRef(new Set<string>());
  const platformRef = useRef(platform);
  platformRef.current = platform;
  // The WS effect only mounts once; period changes need to be visible inside
  // its handler. Read through a ref so we don't tear down the subscription.
  const periodRef = useRef(period);
  periodRef.current = period;

  // Initial REST fetch — re-run when platform or period changes
  useEffect(() => {
    setLoading(true);
    renderedRef.current.clear();
    fetchTrending(period, MAX)
      .then((res) => {
        const seen = new Set<string>();
        const list = toArray<TrendingToken>(res)
          .map(alertRestToToken)
          .filter((t) => {
            if (!t.mint_address || seen.has(t.mint_address)) return false;
            if (platform && !matchesPlatform(t.dex, platform)) return false;
            seen.add(t.mint_address);
            return true;
          });
        list.forEach((t) => renderedRef.current.add(t.mint_address));
        setTokens(list);
        setEnrichKey((k) => k + 1);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [platform, period]);

  useEffect(() => {
    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribe(["alert"]);

    const unsub = ws.on("alert", (msg) => {
      const token = normalizeAlert(msg);
      if (!token) return;

      // Client-side platform filter for WS events
      if (!matchesPlatform(token.dex, platformRef.current)) return;

      const isNew = !renderedRef.current.has(token.mint_address);

      // For period views (daily/weekly/monthly) the list is a server-ranked
      // window — prepending fresh alert events would push the ranked tokens
      // off the bottom and turn the view into a recent-alerts feed. Only
      // merge updates for tokens already in the list; ignore unseen mints.
      if (isNew && periodRef.current !== "recent") return;

      renderedRef.current.add(token.mint_address);

      setTokens((prev) => {
        if (!isNew) {
          return prev.map((t) => {
            if (t.mint_address !== token.mint_address) return t;
            return {
              ...t,
              ...token,
              // Never overwrite enriched identity fields with nulls from WS events
              image:  token.image  || t.image,
              name:   token.name   || t.name,
              symbol: token.symbol || t.symbol,
            };
          });
        }
        return [{ ...token, isNew: true }, ...prev].slice(0, MAX);
      });
    });

    return () => {
      unsub();
      ws.unsubscribe(["alert"]);
    };
  }, []);

  useTokenEnrichment(tokens, setTokens, 20, enrichKey);

  return { tokens, loading };
}
