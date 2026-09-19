/** Fetch token metadata from an on-chain URI and extract social/image fields. */

import { fetchTokenInfo } from "./client";

interface ProxyUriResponse {
  status: number;
  contentType: string;
  bodyB64: string;
}

function decodeBodyToText(b64: string): string {
  // Browsers expose `atob`; this module is "use client"-only via its callers.
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

export interface MetaResult {
  name?: string;
  symbol?: string;
  image?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  uri?: string;
  /** DexScreener "Enhanced Token Info" paid badge. `true`/`false` once the
   *  backend knows; `undefined` while unresolved (the backend kicks an
   *  on-demand check and the next call returns the answer). */
  dexPaid?: boolean;
  /** DexScreener profile URL when known (from the live profile event). */
  dexscreenerUrl?: string;
}

type MetaCacheEntry = MetaResult & {
  publicFetched?: boolean;
  fetchedAt?: number;
};

interface MetadataStore {
  uriCache: Map<string, MetaResult>;
  uriInflight: Map<string, Promise<MetaResult>>;
  mintCache: Map<string, MetaCacheEntry>;
  mintInflight: Map<string, Promise<MetaResult>>;
}

const metadataStore: MetadataStore = {
  uriCache: new Map<string, MetaResult>(),
  uriInflight: new Map<string, Promise<MetaResult>>(),
  mintCache: new Map<string, MetaCacheEntry>(),
  mintInflight: new Map<string, Promise<MetaResult>>(),
};

function clean(value?: string | null): string | undefined {
  const s = value?.trim();
  return s || undefined;
}

/** Normalize on-chain / gateway metadata URIs to fetchable https URLs. */
export function metadataUriToHttp(uri: string): string {
  const raw = uri.trim();
  if (raw.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${raw.slice(7)}`;
  if (raw.startsWith("http://")) return `https://${raw.slice(7)}`;
  return raw;
}

function hasMeta(meta: MetaResult | null | undefined): boolean {
  return Boolean(
    meta?.name ||
    meta?.symbol ||
    meta?.image ||
    meta?.twitter ||
    meta?.telegram ||
    meta?.website ||
    meta?.uri
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
    uri: clean(meta.uri),
    dexPaid: typeof meta.dexPaid === "boolean" ? meta.dexPaid : undefined,
    dexscreenerUrl: clean(meta.dexscreenerUrl),
  };
}

function mergeMeta(existing: MetaCacheEntry | undefined, next: MetaResult, publicFetched?: boolean): MetaCacheEntry {
  const normalized = normalizeMeta(next);
  const merged: MetaCacheEntry = {
    ...existing,
    publicFetched: Boolean(existing?.publicFetched || publicFetched),
  };
  // Plain key copy (was Array<[k, string|undefined]> — that cast silently
  // dropped non-string fields like `dexPaid: boolean`).
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

export async function fetchMetadataFromUri(uri: string): Promise<MetaResult> {
  const key = uri.trim();
  if (!key) return {};
  if (metadataStore.uriCache.has(key)) return metadataStore.uriCache.get(key)!;
  if (metadataStore.uriInflight.has(key)) return metadataStore.uriInflight.get(key)!;

  const inflight = (async () => {
    try {
      const http = metadataUriToHttp(key);
      const res = await fetch(http, { signal: AbortSignal.timeout(12_000) });
      const contentType = res.headers.get("content-type") || "";
      if (contentType.startsWith("image/")) {
        const result: MetaResult = { image: key };
        metadataStore.uriCache.set(key, result);
        return result;
      }
      const json = await res.json() as Record<string, unknown>;

      const ext = (json.extensions ?? {}) as Record<string, unknown>;
      const result = normalizeMeta({
        name:     (json.name     ?? null) as string | undefined,
        symbol:   (json.symbol   ?? null) as string | undefined,
        image:    (json.image    ?? null) as string | undefined,
        twitter:  (ext.twitter   ?? json.twitter  ?? null) as string | undefined,
        telegram: (ext.telegram  ?? json.telegram ?? null) as string | undefined,
        website:  (ext.website   ?? json.website  ?? null) as string | undefined,
      });

      metadataStore.uriCache.set(key, result);
      return result;
    } catch {
      return {};
    }
  })();

  metadataStore.uriInflight.set(key, inflight);
  try {
    return await inflight;
  } finally {
    metadataStore.uriInflight.delete(key);
  }
}

/** Fetch rich metadata (name, symbol, image, socials) from the Raze history API. */
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
      const on: Record<string, unknown> = { name: token.name, symbol: token.symbol, uri: token.uri };
      const off: Record<string, unknown> = {
        name: token.name, symbol: token.symbol, image: token.image,
        twitter: token.twitter, telegram: token.telegram, website: token.website,
      };
      const meta: Record<string, unknown> = { onChain: on, offChain: off };

      const rawUri = (on.uri || undefined) as string | undefined;
      const httpUri = rawUri ? metadataUriToHttp(rawUri) : null;
      // Start URI follow in parallel with API decode — new deploys are rarely
      // indexed yet, so waiting for raze.get before proxy.uri adds seconds.
      const uriPromise = httpUri && !off.image
        ? fetchMetadataFromUri(httpUri)
        : Promise.resolve({} as MetaResult);

      // `metadata.dexPaid` can be true/false/null (null = backend hasn't
      // resolved yet — leave it `undefined` so the UI can render "—").
      const rawDexPaid = meta.dexPaid;
      const result = normalizeMeta({
        name:     (on.name     || off.name     || undefined) as string | undefined,
        symbol:   (on.symbol   || off.symbol   || undefined) as string | undefined,
        image:    (off.image    || undefined) as string | undefined,
        twitter:  (off.twitter  || undefined) as string | undefined,
        telegram: (off.telegram || undefined) as string | undefined,
        website:  (off.website  || undefined) as string | undefined,
        uri:      rawUri,
        dexPaid:  typeof rawDexPaid === "boolean" ? rawDexPaid : undefined,
      });

      if (!result.image && httpUri) {
        try {
          const uriMeta = await uriPromise;
          if (uriMeta.image) result.image = uriMeta.image;
          if (uriMeta.name && !result.name) result.name = uriMeta.name;
          if (uriMeta.symbol && !result.symbol) result.symbol = uriMeta.symbol;
        } catch { /* best-effort */ }
      }

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
