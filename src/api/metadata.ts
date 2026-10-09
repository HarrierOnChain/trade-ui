/** Token identity and socials (name, symbol, image, links) from the API, cached per mint. */

import { fetchTokenInfo } from "./client";

export interface MetaResult {
  name?: string;
  symbol?: string;
  image?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}

type MetaCacheEntry = MetaResult & {
  publicFetched?: boolean;
  fetchedAt?: number;
};

interface MetadataStore {
  mintCache: Map<string, MetaCacheEntry>;
  mintInflight: Map<string, Promise<MetaResult>>;
}

const metadataStore: MetadataStore = {
  mintCache: new Map<string, MetaCacheEntry>(),
  mintInflight: new Map<string, Promise<MetaResult>>(),
};

function clean(value?: string | null): string | undefined {
  const s = value?.trim();
  return s || undefined;
}

function hasMeta(meta: MetaResult | null | undefined): boolean {
  return Boolean(
    meta?.name ||
    meta?.symbol ||
    meta?.image ||
    meta?.twitter ||
    meta?.telegram ||
    meta?.website
  );
}

function normalizeMeta(meta: MetaResult): MetaResult {
  return {
    name: clean(meta.name),
    symbol: clean(meta.symbol),
    image: clean(meta.image),
    twitter: clean(meta.twitter),
    telegram: clean(meta.telegram),
    website: clean(meta.website),
  };
}

function mergeMeta(existing: MetaCacheEntry | undefined, next: MetaResult, publicFetched?: boolean): MetaCacheEntry {
  const normalized = normalizeMeta(next);
  const merged: MetaCacheEntry = {
    ...existing,
    publicFetched: Boolean(existing?.publicFetched || publicFetched),
  };
  for (const k of Object.keys(normalized) as Array<keyof MetaResult>) {
    const v = normalized[k];
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
  }
  return merged;
}

export function getCachedPublicMetadata(mint: string): MetaResult | null {
  const key = mint.trim();
  if (!key) return null;
  return metadataStore.mintCache.get(key) ?? null;
}

export function seedPublicMetadata(mint: string | null | undefined, meta: MetaResult): MetaResult | null {
  const key = mint?.trim();
  if (!key || !hasMeta(meta)) return null;
  const merged = mergeMeta(metadataStore.mintCache.get(key), meta);
  metadataStore.mintCache.set(key, merged);
  return merged;
}

/** Fetch rich metadata (name, symbol, image, socials) from the API's token read. */
export async function fetchPublicMetadata(mint: string): Promise<MetaResult> {
  const key = mint.trim();
  if (!key) return {};

  const cached = metadataStore.mintCache.get(key);
  // Allow retry after 2 s when the token had no image (e.g. not yet indexed)
  const RETRY_MS = 2_000;
  if (cached?.publicFetched) {
    if (cached.image) return cached;
    if (cached.fetchedAt && Date.now() - cached.fetchedAt < RETRY_MS) return cached;
    // TTL expired with no image — fall through and retry
  }
  if (metadataStore.mintInflight.has(key)) return metadataStore.mintInflight.get(key)!;

  const inflight = (async () => {
    try {
      const info = await fetchTokenInfo(key).catch(() => null);
      const token = info?.data;
      if (!token) {
        const empty = mergeMeta(cached, {}, true);
        empty.fetchedAt = Date.now();
        metadataStore.mintCache.set(key, empty);
        return empty;
      }
      const result = normalizeMeta({
        name:     token.name || undefined,
        symbol:   token.symbol || undefined,
        image:    token.image || undefined,
        twitter:  token.twitter || undefined,
        telegram: token.telegram || undefined,
        website:  token.website || undefined,
      });

      const merged = mergeMeta(cached, result, true);
      merged.fetchedAt = Date.now();
      metadataStore.mintCache.set(key, merged);
      return merged;
    } catch {
      return cached ?? {};
    }
  })();

  metadataStore.mintInflight.set(key, inflight);
  try {
    return await inflight;
  } finally {
    metadataStore.mintInflight.delete(key);
  }
}
