/** Same-origin path the <img> tag can load (`/api/raze/tokens/.../image`). */
export function isSameOriginImagePath(raw: string): boolean {
  return raw.startsWith("/") && !raw.startsWith("//");
}

/** True when `image` is a URL TokenIcon can render (not a metadata JSON URI). */
export function isLoadableImageUrl(image?: string | null): boolean {
  const raw = image?.trim();
  if (!raw) return false;
  if (/\.json(\?|$)/i.test(raw)) return false;
  if (raw.includes("/metadata") && !/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(raw)) {
    return false;
  }
  return (
    /^https?:\/\//i.test(raw) ||
    raw.startsWith("ipfs://") ||
    raw.startsWith("data:image/") ||
    isSameOriginImagePath(raw)
  );
}
