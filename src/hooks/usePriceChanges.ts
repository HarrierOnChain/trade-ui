"use client";
import { useEffect, useState } from "react";
import { fetchPriceChanges } from "../api/client";
import type { TokenPriceChanges } from "../types";

export function usePriceChanges(mint: string | null) {
  const [data, setData] = useState<TokenPriceChanges | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mint) {
      setData(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      fetchPriceChanges(mint)
      .then((res) => {
        if (cancelled) return;
        if (res && (res as { success?: boolean }).success !== false) {
          setData(res as TokenPriceChanges);
          setError(null);
        } else {
          setData(null);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mint]);

  return { data, loading, error };
}
