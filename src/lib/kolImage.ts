import { getBackendBase } from "../api/config";

/** Resolve a KOL image path to a full URL served by the regional backend. */
export function kolImageUrl(imagePath: string | null | undefined): string | null {
  if (!imagePath) return null;
  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) return imagePath;
  const base = getBackendBase().replace(/\/$/, "");
  return `${base}${imagePath.startsWith("/") ? imagePath : `/${imagePath}`}`;
}
