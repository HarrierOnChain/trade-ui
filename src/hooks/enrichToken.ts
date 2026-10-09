"use client";
import { fetchPublicMetadata } from "../api/metadata";
import { runPooled } from "../lib/requestPool";
import type { TokenEvent } from "../types";

export function needsEnrich(token: TokenEvent): boolean {
  return (
    !token.name ||
    !token.symbol ||
    !token.image ||
    !token.twitter ||
    !token.telegram ||
    !token.website
  );
}

function patchTokenMeta(
  token: TokenEvent,
  meta: {
    name?: string;
    symbol?: string;
    image?: string;
    twitter?: string;
    telegram?: string;
    website?: string;
  },
  setTokens: React.Dispatch<React.SetStateAction<TokenEvent[]>>,
): void {
  const hasData =
    meta.name || meta.symbol || meta.image ||
    meta.twitter || meta.telegram || meta.website;
  if (!hasData) return;

  setTokens((prev) =>
    prev.map((t) => {
      if (t.mint_address !== token.mint_address) return t;
      let changed = false;
      const next = { ...t };
      if (meta.name     && !t.name)     { next.name     = meta.name;     changed = true; }
      if (meta.symbol   && !t.symbol)   { next.symbol   = meta.symbol;   changed = true; }
      if (meta.image    && !t.image)    { next.image    = meta.image;    changed = true; }
      if (meta.twitter  && !t.twitter)  { next.twitter  = meta.twitter;  changed = true; }
      if (meta.telegram && !t.telegram) { next.telegram = meta.telegram; changed = true; }
      if (meta.website  && !t.website)  { next.website  = meta.website;  changed = true; }
      return changed ? next : t;
    }),
  );
}

/**
 * Fetch metadata (image, socials) for a token and patch it into
 * the tokens list. Work is pooled so a 20-row feed cannot spawn 40+ parallel
 * wire calls.
 */
export function enrichWithMeta(
  token: TokenEvent,
  setTokens: React.Dispatch<React.SetStateAction<TokenEvent[]>>,
): void {
  if (!needsEnrich(token)) return;

  void runPooled(async () => {
    const meta = await fetchPublicMetadata(token.mint_address);
    patchTokenMeta(token, meta, setTokens);
  });
}
