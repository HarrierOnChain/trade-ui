import { getActiveChain, type ChainId } from "./chains";

export function tokenHref(address: string, chain?: string | null): string {
  const c = (chain || getActiveChain()).toLowerCase();
  return `/token/${c}/${encodeURIComponent(address)}`;
}

export function parseTokenPath(pathname: string): { chain: ChainId | string; address: string } | null {
  if (!pathname.startsWith("/token/")) return null;
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length >= 3) {
    return { chain: parts[1]!, address: decodeURIComponent(parts[2]!) };
  }
  if (parts.length === 2) {
    return { chain: getActiveChain(), address: decodeURIComponent(parts[1]!) };
  }
  return null;
}
