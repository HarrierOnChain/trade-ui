"use client";
/**
 * Token images, page-wide: which URLs loaded, which failed, and preloading.
 *
 * A new launch's logo comes from the API's /media, which fetches it from the
 * source on first request (1–2 s). Preloading starts that download when the
 * launch arrives on the stream, not when its row is laid out, and TokenIcon
 * shows a URL this page already decoded at once, without a fade.
 */

// URLs that 404'd / errored, and when: not tried again for a minute. /media
// can fail on a new launch's first request and succeed seconds later; a
// session-long ban left those on initials.
const failed = new Map<string, number>();
const RETRY_FAILED_MS = 60_000;

/** URLs this page has downloaded and decoded. */
const loaded = new Set<string>();
/** Preloads in flight or done, so a URL is asked for once. */
const preloading = new Map<string, HTMLImageElement>();
const PRELOAD_MAX = 1500;

export function imageFailedRecently(src: string): boolean {
  const at = failed.get(src);
  if (at === undefined) return false;
  if (Date.now() - at < RETRY_FAILED_MS) return true;
  failed.delete(src);
  return false;
}

export function markImageFailed(src: string): void {
  failed.set(src, Date.now());
  preloading.delete(src);
}

export function markImageLoaded(src: string): void {
  loaded.add(src);
}

export function imageLoaded(src: string): boolean {
  return loaded.has(src);
}

export function isLoadableImage(src: string): boolean {
  return (
    src.startsWith("data:image/") ||
    /^https?:\/\//i.test(src) ||
    (src.startsWith("/") && !src.startsWith("//"))
  );
}

/** Download and decode `image` now, for a row that is about to render it. */
export function preloadTokenImage(image?: string | null): void {
  if (typeof window === "undefined") return;
  const src = image?.trim() ?? "";
  if (!src || preloading.has(src) || loaded.has(src) || imageFailedRecently(src) || !isLoadableImage(src)) return;
  if (preloading.size >= PRELOAD_MAX) preloading.clear();
  const img = new Image();
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.src = src;
  preloading.set(src, img);
  img.decode().then(
    () => { loaded.add(src); },
    () => { preloading.delete(src); },
  );
}
