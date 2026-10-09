"use client";
import { type ChainId } from "../../lib/chains";
import { Icon } from "./Icon";

/** Glyph for a catalog chain slug. */
export function ChainIcon({ id, size = 14 }: { id: ChainId | string; size?: number }) {
  switch (id) {
    case "sol": return Icon.solana(size);
    case "eth": return Icon.ethereum(size);
    case "bsc": return Icon.bsc(size);
    case "base": return Icon.base(size);
    case "robinhood": return Icon.robinhood(size);
    default: return Icon.solana(size);
  }
}
