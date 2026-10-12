import { fetchSearch } from "./client";
import { seedPublicMetadata } from "./metadata";
import type { SearchResult } from "../types";

export const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function looksLikeSolanaAddress(value: string): boolean {
  const q = value.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(q)) return true;
  return SOLANA_ADDRESS_RE.test(q);
}

/** Hydrate seedPublicMetadata cache from a list of results. */
function seedFromResults(results: SearchResult[]): void {
  results.forEach((r) => {
    seedPublicMetadata(r.mint, { name: r.name, symbol: r.symbol });
  });
}

/**
 * Resolve a free-text or address query into search results: the API's
 * `/search` finds a token by name, symbol or address, by a pool's address
 * (Uniswap V4 and PancakeSwap Infinity pool ids too) and a wallet's created
 * tokens, newest first. Kept under this name for its callers.
 */
export async function fetchSearchWithMetadataFallback(
  query: string,
  limit = 20,
): Promise<{ data: SearchResult[] }> {
  try {
    const res = await fetchSearch(query.trim(), limit);
    const results = Array.isArray(res.data) ? res.data : [];
    seedFromResults(results);
    return { data: results };
  } catch {
    return { data: [] };
  }
}
