/**
 * One swap, end to end: a quote from the router through Trade UI's server,
 * which keeps it (server/quotes.mjs) and hands out a token for it; the server
 * then builds exactly that quote for the wallet, signs it with the key in the
 * vault and sends it (server/solana.mjs); the browser waits for the
 * confirmation on `/api/solana/ws`. The key never reaches the browser, the
 * browser cannot alter the quote it trades, and the server signs nothing but
 * what the router just built for that wallet.
 */
import { confirmSignature, fetchQuote } from "./client";
import { classifyQuoteError, toQuoteView, type QuoteView, type RouterQuote } from "./quote";
export { swapErrorText } from "./quote";
import type { SwapPlan } from "./plan";
import { vault } from "../vault/client";

/** A vault wallet: the server holds its key. */
export interface SwapSigner {
  kind: "vault";
  walletId: string;
  /** its address */
  owner: string;
}

export interface SwapRequest extends SwapPlan {
  slippageBps: number;
  /** the trader's priority fee, total lamports; absent = the router's estimate */
  priorityFeeLamports?: number;
  excludeDexes?: string[];
}

export type SwapStage = "quote" | "sign" | "confirm";

export interface SwapResult {
  signature: string;
  quote: QuoteView;
}

export async function executeSwap(
  signer: SwapSigner,
  req: SwapRequest,
  opts: { quote?: RouterQuote; onStage?: (s: SwapStage) => void } = {},
): Promise<SwapResult> {
  const stage = opts.onStage ?? (() => {});
  let raw = opts.quote;
  if (!raw) {
    stage("quote");
    const r = await fetchQuote({
      inputMint: req.inputMint,
      outputMint: req.outputMint,
      amount: req.amount,
      swapMode: req.swapMode,
      slippageBps: req.slippageBps,
      excludeDexes: req.excludeDexes,
    });
    if (!r.ok) throw new Error(classifyQuoteError(r.status, r.body).message);
    raw = r.quote;
  }
  const quote = toQuoteView(raw);

  if (!raw.quoteToken) throw new Error("This quote cannot be traded: get a new one");
  stage("sign");
  const { signature } = await vault.swap(signer.walletId, raw.quoteToken, req.priorityFeeLamports);

  stage("confirm");
  await confirmSignature(signature, 60_000);
  return { signature, quote };
}
