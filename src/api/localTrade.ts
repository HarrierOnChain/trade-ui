/**
 * `trade.execute` in Trade UI: on Solana the swap runs on the Raze Solana
 * router, on Ethereum, BNB Chain, Base and Robinhood on the Raze EVM router
 * (src/lib/evm/trade.ts). The router quotes, the server builds that quote for
 * the wallet, signs it with the key in the vault and sends it. Resolves once
 * the transaction is confirmed.
 */
import { getActiveChain, isEvmChain } from "../lib/chains";
import { executeEvmTrade } from "../lib/evm/trade";
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
  const chain = getActiveChain();
  if (isEvmChain(chain)) {
    const { signature } = await executeEvmTrade(chain, body);
    return { signature, region: "router-evm" };
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
