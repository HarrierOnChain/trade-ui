import { fetchSearch, fetchTokensByDeployer } from "./client";
import { fetchPublicMetadata, seedPublicMetadata } from "./metadata";
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
    seedPublicMetadata(r.mint, { name: r.name, symbol: r.symbol, uri: r.uri });
  });
}

/**
 * Resolve a free-text or address query into search results.
 *
 * Order of attempts:
 * 1. Text-search the local trade-derived index (`/api/sol/tokens/search?q=…`).
 * 2. If the query is a Solana address and step 1 returned nothing, try the
 *    CryptoHouse-backed Metaplex search as a deployer (`?creator=…`) — covers
 *    the case where the user pasted a wallet address, not a mint.
 * 3. If still nothing and the query is an address, fall back to the metadata
 *    endpoint (treats the address as a mint and pulls its on-chain Metaplex).
 */
export async function fetchSearchWithMetadataFallback(
  query: string,
  limit = 20,
): Promise<{ data: SearchResult[] }> {
  const q = query.trim();
  let results: SearchResult[] = [];

  try {
    const res = await fetchSearch(q, limit);
    results = Array.isArray(res.data) ? res.data : [];
    seedFromResults(results);
  } catch {
    results = [];
  }

  if (results.length > 0) {
    return { data: results };
  }

  if (!looksLikeSolanaAddress(q)) {
    return { data: [] };
  }

  // Wallet-address case: try interpreting the input as a deployer.
  try {
    const res = await fetchSearch({ creator: q, limit });
    const deployerResults = Array.isArray(res.data) ? res.data : [];
    if (deployerResults.length > 0) {
      seedFromResults(deployerResults);
      return { data: deployerResults };
    }
  } catch {
    // ignore — fall through to metadata path
  }

  // Last resort: treat the address as a mint and pull its on-chain metadata.
  const meta = await fetchPublicMetadata(q);
  const name = meta.name?.trim();
  const symbol = meta.symbol?.trim();

  if (!name && !symbol) {
    return { data: [] };
  }

  return {
    data: [{
      mint: q,
      symbol: symbol || name || "TOKEN",
      name: name || symbol || q,
      platform: "metadata",
    }],
  };
}

/** Direct: list tokens deployed by a wallet, no fallbacks. */
export async function fetchDeployerTokens(
  walletAddress: string,
  limit = 20,
  page = 1,
): Promise<{ data: SearchResult[] }> {
  if (!looksLikeSolanaAddress(walletAddress)) {
    return { data: [] };
  }
  try {
    const res = await fetchTokensByDeployer(walletAddress, limit, page);
    const data = Array.isArray(res.data) ? res.data : [];
    seedFromResults(data);
    return { data };
  } catch {
    return { data: [] };
  }
}
