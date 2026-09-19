"use client";
import { useEffect, useState } from "react";
import { fetchCreatorMigrations, type CreatorMigration } from "../api/client";

/**
 * The dev's migrated tokens + each token's ATH market cap. Fetches only when
 * `enabled` flips true — callers pass the crown popup's open state so the
 * request fires on hover, not on every token-page load. Result is cached
 * server-side (300s) and single-flighted by `razeGet`.
 */
export function useCreatorMigrations(
  signer: string | undefined,
  enabled: boolean,
): { data: CreatorMigration[] | null; loading: boolean } {
  const [data, setData] = useState<CreatorMigration[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !signer) return;
    let cancelled = false;
    setLoading(true);
    fetchCreatorMigrations(signer)
      .then((r) => {
        if (cancelled) return;
        setData(Array.isArray(r.data) ? r.data : []);
      })
      .catch(() => {
        if (!cancelled) setData([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [signer, enabled]);

  return { data, loading };
}
