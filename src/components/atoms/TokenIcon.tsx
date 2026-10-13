"use client";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { hash } from "../../lib/random";
import {
  imageFailedRecently,
  imageLoaded,
  isLoadableImage,
  markImageFailed,
  markImageLoaded,
} from "../../lib/tokenImages";

interface Props {
  token: { mint_address?: string; symbol?: string; image?: string | null; chain?: string };
  size?: number;
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The image the API gives (an https URL an <img> loads, IPFS through its
 *  `/media`), or none: the initials. */
function buildImageCandidates(image?: string | null): string[] {
  const src = image?.trim() ?? "";
  if (!src || imageFailedRecently(src)) return [];
  return isLoadableImage(src) ? [src] : [];
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

  // The initials stay underneath until the image has loaded, then it fades in
  // over them; an image this page already decoded shows at once.
  const [shown, setShown] = useState(() => (src ? imageLoaded(src) : false));
  const [instant, setInstant] = useState(() => (src ? imageLoaded(src) : false));
  const imgRef = useRef<HTMLImageElement | null>(null);
  useIsoLayoutEffect(() => {
    if (!src) {
      setShown(false);
      return;
    }
    const cached = imageLoaded(src);
    setInstant(cached);
    // A cached image can finish before React attaches onLoad.
    const el = imgRef.current;
    setShown(cached || Boolean(el && el.complete && el.naturalWidth > 0));
  }, [src]);

  return (
    <div style={{
      position: "relative",
      width: size, height: size,
      flexShrink: 0,
      borderRadius: 4,
      overflow: "hidden",
      // The initials' tile only while there is no image: a round or
      // transparent logo must not sit on a square.
      backgroundImage: shown ? "none" : `linear-gradient(135deg, ${bg1}, ${bg2})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-mono)",
      fontSize: size <= 24 ? 9 : size <= 36 ? 11 : 14,
      fontWeight: 600,
      color: "oklch(0.98 0.01 85)",
      letterSpacing: "0.02em",
      boxShadow: shown ? "none" : "inset 0 0 0 1px oklch(1 0 0 / 0.08)",
    }}>
      <span aria-hidden={shown} style={{ opacity: shown ? 0 : 1, transition: instant ? "none" : "opacity 160ms ease-out" }}>
        {initials}
      </span>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          ref={imgRef}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => {
            markImageLoaded(src);
            setShown(true);
          }}
          onError={() => {
            markImageFailed(src);
            setShown(false);
            setImgIndex((current) => current + 1);
          }}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
            opacity: shown ? 1 : 0,
            transition: instant ? "none" : "opacity 220ms ease-out",
          }}
        />
      )}
    </div>
  );
}
