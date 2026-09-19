"use client";
import { useEffect, useState } from "react";
import { fetchQuote, type QuoteData } from "../api/client";

export function useTokenQuote(mint: string | null) {
  const [quote, setQuote] = useState<QuoteData | null>(null);

  useEffect(() => {
    if (!mint) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuote(null);

    // Quote is best-effort enrichment. fetchQuote routes through the wire
    // (`raze.get`) so the apiKey never leaves the backend; the upstream may
    // still respond `{ success: false }` when no route exists, in which case
    // we leave `quote` null and the header falls back to `token.dex` /
    // `token.migrated_at`.
    fetchQuote(mint)
      .then((body) => {
        if (cancelled) return;
        if (!body?.success || !body.data) return;
        const platform = body.data.platform?.trim() ?? "";
        if (!platform || platform.toLowerCase() === "unknown") return;
        setQuote(body.data);
      })
      .catch(() => { /* network/upstream error — keep fallback */ });

    return () => { cancelled = true; };
  }, [mint]);

  return quote;
}
