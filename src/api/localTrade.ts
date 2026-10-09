/**
 * `trade.execute` in Trade UI: the swap runs on the Raze Solana router. The
 * router quotes, the server builds that quote for the wallet, signs it with
 * the key in the vault and sends it; the browser confirms. Resolves once the
 * transaction is confirmed.
 */
import { swapsOn } from "../lib/chains";
import { mintDecimals, tokenBalanceRaw } from "../lib/swap/client";
import { executeSwap, swapErrorText, type SwapSigner } from "../lib/swap/execute";
import { planTrade, type TradeBody } from "../lib/swap/plan";
import { solanaWallet } from "./vaultWallets";

export type { TradeBody };

const DEFAULT_SLIPPAGE_BPS = 100;

export function solanaSigner(walletId: string): SwapSigner {
  const w = solanaWallet(walletId);
  return { kind: "vault", walletId: w.id, owner: w.address };
}

export async function executeLocalTrade(body: TradeBody): Promise<{ signature: string; region: string }> {
  if (!swapsOn()) {
    throw new Error("Swaps run on Solana for now: the EVM router does not quote yet");
  }
  const signer = solanaSigner(body.walletId);
  try {
    const plan = await planTrade(body, {
      decimals: mintDecimals,
      balanceRaw: (mint) => tokenBalanceRaw(signer.owner, mint),
    });
    const slippageBps = Number.isFinite(body.slippageBps) ? Math.round(body.slippageBps!) : DEFAULT_SLIPPAGE_BPS;
    const fee = body.transactionsFeeLamports;
    const { signature } = await executeSwap(signer, {
      ...plan,
      slippageBps: Math.min(10_000, Math.max(0, slippageBps)),
      priorityFeeLamports: typeof fee === "number" && Number.isFinite(fee) && fee >= 0 ? Math.floor(fee) : undefined,
    });
    return { signature, region: "router" };
  } catch (e) {
    throw new Error(swapErrorText(e));
  }
}
