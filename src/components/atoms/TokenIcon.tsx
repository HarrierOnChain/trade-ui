"use client";
import React, { useEffect, useMemo, useState } from "react";
import { imageSrc } from "../../api/evmapi";
import { getImgProxyBase } from "../../api/config";
import { getActiveChain } from "../../lib/chains";
import { hash } from "../../lib/random";

/** Build the regional backend URL for the `/img` proxy. The `<img>` tag
 *  needs a URL (not a wire RPC), so image bytes are the one carve-out from
 *  the wire-only rule — backend talks to Raze with the server-side apiKey. */
function backendImg(razeProxyUrl: string): string {
  const base = getImgProxyBase().replace(/\/$/, "");
  return `${base}/img?razeProxy=${encodeURIComponent(razeProxyUrl)}`;
}

/** Gateways for <img> — Pinata first (pump.fun pins there). i.raze.sh only
 *  has CIDs this host uploaded; ipfs.io is last because it is slow. */
const IPFS_GATEWAY_PREFIXES = [
  "https://pump.mypinata.cloud/ipfs/",
  "https://i.raze.sh/ipfs/",
  "https://ipfs.io/ipfs/",
] as const;

interface Props {
  token: { mint_address?: string; symbol?: string; image?: string | null; chain?: string };
  size?: number;
}

// Session-level memo: which candidate URL successfully loaded for a given
// `image` source string. When the same token re-mounts (list re-render,
// scroll back, opened in another panel), we render the known-good URL on
// the first paint instead of walking the candidate list and waiting for
// each gateway to time out.
const resolvedCache = new Map<string, string>();
// URLs that 404'd / errored this session — drop from candidate lists so
// future mounts don't re-attempt them.
const failedCache = new Set<string>();

function ownImageSrc(mint?: string, chain?: string): string | null {
  const m = mint?.trim();
  if (!m) return null;
  const c = (chain?.trim() || getActiveChain() || "sol");
  return imageSrc(`/tokens/${c}/${encodeURIComponent(m)}/image`);
}

function buildImageCandidates(
  image?: string | null,
  mint?: string,
  chain?: string,
): string[] {
  const raw = image?.trim() ?? "";

  const addUnique = (list: string[], value?: string | null) => {
    const next = value?.trim();
    if (!next || list.includes(next)) return;
    if (next.startsWith("data:image/")) {
      list.push(next);
      return;
    }
    const http = /^https?:\/\//i.test(next);
    const relative = next.startsWith("/") && !next.startsWith("//");
    // Browsers can't load `ipfs://` or bare CIDs from <img>, so skip them
    // — they'd just trigger an immediate onError and waste a render.
    if (!http && !relative) return;
    if (failedCache.has(next)) return;
    list.push(next);
  };

  // Extract IPFS path from any of: ipfs://<cid>[/...], <gateway>/ipfs/<cid>[/...],
  // or bare CID (CIDv0 `Qm...` 46 chars, or any CIDv1 — base32 form starts
  // with `b` and is 50+ chars). Returns "" if not IPFS.
  const ipfsPath = raw.startsWith("ipfs://")
    ? raw.slice(7).replace(/^ipfs\//, "")
    : raw.includes("/ipfs/")
    ? raw.slice(raw.indexOf("/ipfs/") + 6)
    : /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})(\/.*)?$/.test(raw)
    ? raw
    : "";

  const candidates: string[] = [];

  // Hosts the Raze image proxy (`/api/sol/image/proxy`) is willing to
  // fetch on our behalf. Must stay in sync with the backend allowlist in
  // raze/solana/history/src/api/handlers/image_proxy.rs.
  const PROXY_ALLOWED_PREFIXES = [
    "https://ipfs.io/",
    "https://gateway.pinata.cloud/",
    "https://pump.mypinata.cloud/",
    "https://arweave.net/",
    "https://nftstorage.link/",
    "https://cloudflare-ipfs.com/",
    "https://cf-ipfs.com/",
    "https://i.raze.sh/",
    "https://pbs.twimg.com/",
    "https://abs.twimg.com/",
    "https://cdn.discordapp.com/",
    "https://media.discordapp.net/",
    "https://i.imgur.com/",
    "https://imgur.com/",
    "https://raw.githubusercontent.com/",
    "https://shdw-drive.genesysgo.net/",
    "https://image.dexscreener.com/",
    "https://dd.dexscreener.com/",
    "https://dweb.link/",
    "https://w3s.link/",
  ];
  const proxyable = (u: string) => PROXY_ALLOWED_PREFIXES.some((p) => u.startsWith(p));

  // The API's image route (`/v1/tokens/{chain}/{address}/image`, a 302 to
  // the token's image). First when the row carries no image of its own;
  // after the row's own URL otherwise, which saves the redirect hop.
  if (!raw) addUnique(candidates, ownImageSrc(mint, chain));

  if (ipfsPath) {
    for (const prefix of IPFS_GATEWAY_PREFIXES) {
      addUnique(candidates, `${prefix}${ipfsPath}`);
    }
    const fleetUrl = `https://pump.mypinata.cloud/ipfs/${ipfsPath}`;
    const proxyBase = getImgProxyBase().replace(/\/$/, "");
    if (proxyBase) {
      addUnique(candidates, `${proxyBase}/img?url=${encodeURIComponent(fleetUrl)}`);
      addUnique(candidates, backendImg(fleetUrl));
    }
  } else if (raw) {
    const httpsUrl = raw.startsWith("http://") ? "https://" + raw.slice(7) : raw;
    addUnique(candidates, httpsUrl);
    // Adblockers commonly block twimg / discord CDNs. The proxy bypasses
    // that by serving the bytes from our own origin.
    const proxyBase = getImgProxyBase().replace(/\/$/, "");
    if (proxyBase && proxyable(httpsUrl)) {
      addUnique(candidates, backendImg(httpsUrl));
    }
  }

  addUnique(candidates, ownImageSrc(mint, chain));

  return candidates;
}

export function TokenIcon({ token, size = 32 }: Props) {
  const cacheKey = `${token.mint_address ?? ""}|${token.image?.trim() ?? ""}`;
  const candidates = useMemo(() => {
    const list = buildImageCandidates(token.image, token.mint_address, token.chain);
    // If we already know which candidate works for this image, hoist it
    // to position 0 so the first render hits a cached/warm URL.
    const cached = cacheKey ? resolvedCache.get(cacheKey) : undefined;
    if (cached) {
      const idx = list.indexOf(cached);
      if (idx > 0) {
        list.splice(idx, 1);
        list.unshift(cached);
      } else if (idx < 0 && !failedCache.has(cached)) {
        list.unshift(cached);
      }
    }
    return list;
  }, [token.image, token.mint_address, token.chain, cacheKey]);
  const [imgIndex, setImgIndex] = useState(0);

  useEffect(() => {
    setImgIndex(0);
  }, [token.image, token.mint_address, token.symbol, token.chain]);

  const seed = hash(token.mint_address || token.symbol || "x");
  const hue = seed % 360;
  const bg1 = `oklch(0.45 0.12 ${hue})`;
  const bg2 = `oklch(0.32 0.10 ${(hue + 40) % 360})`;
  const initials = (
    token.symbol || (token.mint_address || "??").slice(0, 2)
  )
    .slice(0, 2)
    .toUpperCase();
  const src = candidates[imgIndex] ?? null;
  return (
    <div style={{
      width: size, height: size,
      flexShrink: 0,
      borderRadius: 4,
      overflow: "hidden",
      background: src ? "var(--ink-2)" : `linear-gradient(135deg, ${bg1}, ${bg2})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-mono)",
      fontSize: size <= 24 ? 9 : size <= 36 ? 11 : 14,
      fontWeight: 600,
      color: "oklch(0.98 0.01 85)",
      letterSpacing: "0.02em",
      boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.08)",
    }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => {
            if (cacheKey) resolvedCache.set(cacheKey, src);
          }}
          onError={() => {
            failedCache.add(src);
            setImgIndex((current) => current + 1);
          }}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        initials
      )}
    </div>
  );
}
