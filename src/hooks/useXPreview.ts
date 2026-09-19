"use client";
import { useEffect, useState } from "react";
import { BackendClient, useSession, type XPreviewResponse } from "../api/backend";
import { useRegion } from "../contexts/RegionContext";

// Module-level cache shared across all popups so hovering the same X link
// twice in the session is free. Backend already TTL-caches but we want to
// skip the round-trip entirely on repeat hovers within the same tab.
type CacheEntry =
  | { state: "ready"; data: XPreviewResponse; expiresAt: number }
  | { state: "loading"; promise: Promise<XPreviewResponse>; expiresAt: number };

const CLIENT_TTL_MS = 5 * 60_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(baseUrl: string, url: string): string {
  return `${baseUrl}::${url}`;
}

export interface UseXPreviewResult {
  data: XPreviewResponse | null;
  loading: boolean;
  error: string | null;
}

// `enabled` controls whether the fetch fires. Callers pass `enabled=true`
// only after the popup has been hover-opened so we don't pre-fetch every
// X link in a 200-row feed.
export function useXPreview(url: string | null, enabled: boolean): UseXPreviewResult {
  const { region } = useRegion();
  const session = useSession();
  const [data, setData] = useState<XPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !url || !session?.token) {
      // Don't clear data on disable — keeps the rendered card stable when
      // the user briefly leaves the icon and re-enters.
      return;
    }

    const key = cacheKey(region.baseUrl, url);
    const now = Date.now();
    const cached = cache.get(key);

    if (cached && cached.expiresAt > now) {
      if (cached.state === "ready") {
        setData(cached.data);
        setLoading(false);
        setError(null);
        return;
      }
      // Already in-flight — piggyback on the existing promise.
      let cancelled = false;
      setLoading(true);
      cached.promise.then(
        (d) => { if (!cancelled) { setData(d); setLoading(false); setError(null); } },
        (e: unknown) => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } },
      );
      return () => { cancelled = true; };
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    const client = new BackendClient(region.baseUrl, session.token);
    const promise = client.xPreview(url);
    cache.set(key, { state: "loading", promise, expiresAt: now + CLIENT_TTL_MS });

    promise.then(
      (d) => {
        cache.set(key, { state: "ready", data: d, expiresAt: Date.now() + CLIENT_TTL_MS });
        if (!cancelled) { setData(d); setLoading(false); }
      },
      (e: unknown) => {
        cache.delete(key);
        if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); }
      },
    );

    return () => { cancelled = true; };
  }, [enabled, url, region.baseUrl, session?.token]);

  return { data, loading, error };
}
