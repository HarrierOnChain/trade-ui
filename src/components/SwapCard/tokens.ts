/**
 * Tokens the swap card knows without a lookup (instant symbol and image), and
 * the ones learned from search picks this session.
 */
import { SOL_MINT, USDC_MINT } from "../../lib/swap/quote";
import { shortAddr } from "../../lib/format";

export interface SwapToken {
  mint: string;
  symbol: string;
  name?: string;
  image?: string | null;
  /** native (SOL) per token, from a search row */
  priceSol?: number | null;
}

// Canonical mints; do not guess new ones.
export const KNOWN_TOKENS: SwapToken[] = [
  { mint: SOL_MINT, symbol: "SOL", name: "Solana" },
  { mint: USDC_MINT, symbol: "USDC", name: "USD Coin" },
  { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "Tether USD" },
  { mint: "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB", symbol: "USD1", name: "World Liberty USD" },
  { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk" },
  { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter" },
  { mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat" },
  { mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", symbol: "RAY", name: "Raydium" },
  { mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", symbol: "JTO", name: "Jito" },
  { mint: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump", symbol: "FARTCOIN", name: "Fartcoin" },
];

/** USD-pegged: priced at $1 without a lookup. */
export const STABLES = new Set([
  USDC_MINT,
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
]);

const learned = new Map<string, SwapToken>();

export function learnToken(t: SwapToken): void {
  if (!KNOWN_TOKENS.some((k) => k.mint === t.mint)) learned.set(t.mint, t);
}

export function tokenFor(mint: string): SwapToken {
  return KNOWN_TOKENS.find((t) => t.mint === mint) ?? learned.get(mint) ?? { mint, symbol: shortAddr(mint, 4) };
}
