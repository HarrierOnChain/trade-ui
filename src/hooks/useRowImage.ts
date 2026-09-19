"use client";
import { useEffect, useState } from "react";
import { fetchPublicMetadata } from "../api/metadata";
import { isLoadableImageUrl } from "../lib/imageUrl";
import { runPooled } from "../lib/requestPool";
import { streamSettledDelay } from "../lib/wire/events";

const RETRY_MS = 8_000;
const MAX_ATTEMPTS = 3;
const ROW_STAGGER_MS = 120;

/**
 * Per-row image resolver. Deferred + staggered so monitor streaming (raze.feed)
 * wins the wire before metadata fetches.
 */
export function useRowImage(
  mint: string,
  image?: string | null,
  rowIndex = 0,
): string | null | undefined {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (isLoadableImageUrl(image)) {
      setResolved(null);
      return;
    }
    if (!mint) return;

    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const attempt = () => {
      void runPooled(() => fetchPublicMetadata(mint))
        .then((meta) => {
          if (cancelled) return;
          if (meta.image && isLoadableImageUrl(meta.image)) {
            setResolved(meta.image);
            return;
          }
          attempts += 1;
          if (attempts < MAX_ATTEMPTS) {
            timer = setTimeout(attempt, RETRY_MS);
          }
        })
        .catch(() => {
          if (cancelled) return;
          attempts += 1;
          if (attempts < MAX_ATTEMPTS) {
            timer = setTimeout(attempt, RETRY_MS);
          }
        });
    };

    const startDelay = streamSettledDelay() + rowIndex * ROW_STAGGER_MS;
    timer = setTimeout(attempt, startDelay);

    return () => {
      cancelled = true;
      if (timer != null) clearTimeout(timer);
    };
  }, [mint, image, rowIndex]);

  if (isLoadableImageUrl(image)) return image;
  return resolved ?? image;
}
