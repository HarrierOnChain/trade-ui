// Launch-platform filter options, per chain. `value` must match the exact
// `platform` string the upstream returns so the server-side filter hits rows;
// `label` is the compact display name.
//
// The active chain is read from the module-level mirror in lib/chains.ts
// (same pattern the data fetchers use); the top-bar chain switch hard-reloads
// so this is correct at render/module-init time.
import { type ChainId, getActiveChain } from "../../lib/chains";
import { SOL_PLATFORM_CHIPS } from "../../lib/launchpadPlatforms.generated";

export interface Platform {
  label: string;
  value: string;
}

const PLATFORMS_BY_CHAIN: Record<ChainId, Platform[]> = {
  sol: SOL_PLATFORM_CHIPS.filter((p) => p.value !== "Pons"),
  eth: [
    { label: "Uniswap v2", value: "Uniswap v2" },
    { label: "Uniswap v4", value: "Uniswap v4" },
  ],
  bsc: [
    { label: "Four.meme", value: "Four.meme" },
    { label: "Flap", value: "Flap" },
    { label: "Printr", value: "Printr" },
  ],
  base: [
    { label: "Bankr", value: "Bankr" },
    { label: "Clanker", value: "Clanker" },
  ],
  robinhood: [
    { label: "Pons", value: "Pons" },
    { label: "hood.fun", value: "hood.fun" },
    { label: "flap.sh", value: "flap.sh" },
    { label: "stonks.fun", value: "stonks.fun" },
  ],
};

/** Launch-platform options for `chain` (defaults to the active chain). */
export function platforms(chain: ChainId = getActiveChain()): Platform[] {
  return PLATFORMS_BY_CHAIN[chain] ?? [];
}

/** Comma-joined "all platforms" filter for `chain`. Empty when the chain has
 *  no launchpad detection — callers treat an empty string as "no filter". */
export function defaultPlatformFilter(chain: ChainId = getActiveChain()): string {
  return platforms(chain).map((p) => p.value).join(",");
}
