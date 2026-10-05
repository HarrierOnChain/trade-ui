/**
 * One swap, end to end: quote on the router, build for the wallet, sign, send,
 * confirm. The router never signs or sends; the key (a local wallet) or the
 * browser wallet does, and the RPC behind `/api/solana/*` broadcasts and
 * confirms.
 */
import {
  buildSwap,
  confirmSignature,
  fetchQuote,
  sendSigned,
} from "./client";
import { classifyQuoteError, toQuoteView, type QuoteView, type RouterQuote } from "./quote";
export { swapErrorText } from "./quote";
import {
  chooseTransaction,
  quoteReserveKeys,
  signLocal,
  signWithWallet,
  walletVersions,
  type StdWallet,
} from "./sign";
import type { SwapPlan } from "./plan";

export type SwapSigner =
  | { kind: "local"; owner: string; secretKey: Uint8Array }
  | { kind: "browser"; owner: string; wallet: StdWallet };

export interface SwapRequest extends SwapPlan {
  slippageBps: number;
  /** the trader's priority fee, total lamports; absent = the router's estimate */
  priorityFeeLamports?: number;
  excludeDexes?: string[];
}

export type SwapStage = "quote" | "build" | "sign" | "send" | "confirm";

export interface SwapResult {
  signature: string;
  quote: QuoteView;
}

/** Whether this signer needs the v0 form (a browser wallet without v1). */
export function needsV0(signer: SwapSigner): boolean {
  return signer.kind === "browser" && quoteReserveKeys(walletVersions(signer.wallet)) !== undefined;
}

/** The `reserveKeys` to quote with for this signer. */
export function signerReserveKeys(signer: SwapSigner): number | undefined {
  return signer.kind === "browser" ? quoteReserveKeys(walletVersions(signer.wallet)) : undefined;
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
      reserveKeys: signerReserveKeys(signer),
    });
    if (!r.ok) throw new Error(classifyQuoteError(r.status, r.body).message);
    raw = r.quote;
  }
  const quote = toQuoteView(raw);

  stage("build");
  const v0 = needsV0(signer);
  const build = await buildSwap(signer.owner, raw, { priorityFeeLamports: req.priorityFeeLamports, v0 });

  stage("sign");
  let signature: string;
  if (signer.kind === "local") {
    const { signed, signature: sig } = signLocal(build.transaction, signer.secretKey);
    stage("send");
    const sent = await sendSigned(signed);
    signature = sent || sig;
  } else {
    const choice = chooseTransaction(walletVersions(signer.wallet), build);
    if ("error" in choice) throw new Error(choice.error);
    const out = await signWithWallet(signer.wallet, signer.owner, choice.b64);
    if (out.sent) {
      signature = out.signature;
    } else {
      stage("send");
      signature = await sendSigned(out.signed);
    }
  }

  stage("confirm");
  await confirmSignature(signature, 60_000);
  return { signature, quote };
}
