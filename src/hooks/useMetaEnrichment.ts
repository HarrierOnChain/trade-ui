"use client";
import { useEffect, useMemo, useRef } from "react";
import { enrichWithMeta, needsEnrich } from "./enrichToken";
import type { TokenEvent } from "../types";

/**
 * Deferred, pooled off-chain metadata enrichment (image + socials) for the top
 * visible feed rows.
 *
 * Kept deliberately separate from `useTokenEnrichment` (batched stats, which
 * skips metadata on purpose — see its header: batching proxy.uri/raze.get was
 * starving raze.feed delivery). This routes each row through
 * `enrichWithMeta` → `runPooled` (≤4 concurrent, cached, deduped) and only
 * after a settle delay, so it never floods the wire on stream open. It is what
 * fills token.{twitter,telegram,website} → the social icons on the Monitor
 * cards (TokenCard reads those fields directly).
 */
const SETTLE_MS = 2000;

export function useMetaEnrichment(
  tokens: TokenEvent[],
  setTokens: React.Dispatch<React.SetStateAction<TokenEvent[]>>,
  maxRows = 20,
  resetKey = 0,
) {
  const prevResetKey = useRef(resetKey);
  // Mints already handed to enrichWithMeta — fire once each, even if the token
  // genuinely has no socials (so needsEnrich stays true forever otherwise).
  const doneRef = useRef<Set<string>>(new Set());
  // Latest tokens, read inside the timer so live price/stat patches don't have
  // to be an effect dependency (which would restart the settle timer).
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;

  // Set of top-N mints still needing metadata that we haven't fired yet. The
  // effect keys on this string, not the whole array, so streaming updates that
  // don't change the pending set won't reset the timer.
  const pendingKey = useMemo(
    () =>
      tokens
        .slice(0, maxRows)
        .filter(
          (t) =>
            t.mint_address &&
            needsEnrich(t) &&
            !doneRef.current.has(t.mint_address),
        )
        .map((t) => t.mint_address)
        .join(","),
    [tokens, maxRows],
  );

  useEffect(() => {
    if (resetKey !== prevResetKey.current) {
      prevResetKey.current = resetKey;
      doneRef.current = new Set();
    }
    if (!pendingKey) return;

    const timer = setTimeout(() => {
      const pending = new Set(pendingKey.split(",").filter(Boolean));
      tokensRef.current
        .slice(0, maxRows)
        .filter(
          (t) => pending.has(t.mint_address) && !doneRef.current.has(t.mint_address),
        )
        .forEach((t) => {
          doneRef.current.add(t.mint_address);
          enrichWithMeta(t, setTokens);
        });
    }, SETTLE_MS);

    return () => clearTimeout(timer);
  }, [pendingKey, maxRows, setTokens, resetKey]);
}
