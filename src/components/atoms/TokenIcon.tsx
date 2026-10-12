"use client";
import React, { useEffect, useMemo, useState } from "react";
import { hash } from "../../lib/random";

interface Props {
  token: { mint_address?: string; symbol?: string; image?: string | null; chain?: string };
  size?: number;
}

// URLs that 404'd / errored this session: not tried again.
const failedCache = new Set<string>();

/** The image the API gives (an https URL an <img> loads, IPFS through its
 *  `/media`), or none: the initials. */
function buildImageCandidates(image?: string | null): string[] {
  const src = image?.trim() ?? "";
  if (!src || failedCache.has(src)) return [];
  const loadable =
    src.startsWith("data:image/") ||
    /^https?:\/\//i.test(src) ||
    (src.startsWith("/") && !src.startsWith("//"));
  return loadable ? [src] : [];
}

export function TokenIcon({ token, size = 32 }: Props) {
  const candidates = useMemo(() => buildImageCandidates(token.image), [token.image]);
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
