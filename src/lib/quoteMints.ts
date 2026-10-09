/**
 * Quote assets accepted as the "pay with" input for buys and the "receive"
 * output for sells, per chain.
 *
 * `mint: null` is the native sentinel — the chain's native gas asset (SOL on
 * Solana). The trade routes omit `inputMint`/`outputMint` for it and fall
 * back to the native SOL path on the Raze router.
 *
 * The active chain is read from the module-level mirror in `chains.ts` (same
 * pattern the data fetchers use). The top-bar chain switch hard-reloads, so
 * `getActiveChain()` is correct at render/module-init time and callers don't
 * have to thread `chain` through.
 */
import { type ChainId, getActiveChain } from "./chains";

export interface QuoteMint {
  /** UI label shown in the cycler. */
  label: string;
  /** Mint/token address, or null for the chain's native asset. */
  mint: string | null;
  /** Token decimals — used to convert UI amounts to raw units for buys. */
  decimals: number;
}

const QUOTE_MINTS_BY_CHAIN: Record<ChainId, QuoteMint[]> = {
  sol: [
    { label: "SOL",  mint: null,                                            decimals: 9 },
    { label: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
    { label: "USD1", mint: "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",  decimals: 6 },
  ],
  eth: [
    { label: "ETH", mint: null, decimals: 18 },
    { label: "USDC", mint: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
  ],
  bsc: [
    { label: "BNB", mint: null, decimals: 18 },
    { label: "USDC", mint: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", decimals: 18 },
  ],
  base: [
    { label: "ETH", mint: null, decimals: 18 },
    { label: "USDC", mint: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  ],
  robinhood: [
    { label: "ETH", mint: null, decimals: 18 },
  ],
};

/** Quote assets available on `chain` (defaults to the active chain). */
export function quoteMints(chain: ChainId = getActiveChain()): QuoteMint[] {
  return QUOTE_MINTS_BY_CHAIN[chain] ?? QUOTE_MINTS_BY_CHAIN.sol;
}

/** The default ("native") quote for `chain`. */
export function defaultQuoteMint(chain: ChainId = getActiveChain()): QuoteMint {
  return quoteMints(chain)[0];
}

/** Resolve a stored label to a quote on `chain`; falls back to the native
 *  quote so an unknown/stale label cleanly resolves to that chain's quote
 *  instead of showing nothing. */
export function findQuoteMint(label: string, chain: ChainId = getActiveChain()): QuoteMint {
  const list = quoteMints(chain);
  return list.find((m) => m.label === label) ?? list[0];
}

/** USDC / USD1 mints — cash quotes, not spot bags in holdings or unrealized PnL. */
export function stableQuoteMintAddresses(chain: ChainId = getActiveChain()): string[] {
  return quoteMints(chain)
    .filter((q) => q.mint != null && q.label !== "SOL")
    .map((q) => q.mint!);
}

export function isStableQuoteMint(mint: string, chain: ChainId = getActiveChain()): boolean {
  return stableQuoteMintAddresses(chain).includes(mint);
}
