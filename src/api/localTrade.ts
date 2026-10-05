/**
 * `trade.execute` in Trade UI: the swap runs on the Raze Solana router from
 * this machine. The router quotes and builds; the wallet's own key (a local
 * wallet) or the browser wallet signs; the RPC behind `/api/solana/*` sends
 * and confirms. Resolves once the transaction is confirmed.
 */
import { getActiveChain } from "../lib/chains";
import { BROWSER_WALLET_ID, getBrowserWallet } from "../lib/swap/browserWallet";
import { mintDecimals, tokenBalanceRaw } from "../lib/swap/client";
import { executeSwap, swapErrorText, type SwapSigner } from "../lib/swap/execute";
import { planTrade, type TradeBody } from "../lib/swap/plan";
import { localSolanaSigner } from "./localWallets";

export type { TradeBody };

const DEFAULT_SLIPPAGE_BPS = 100;

export function solanaSigner(walletId: string): SwapSigner {
  if (walletId === BROWSER_WALLET_ID) {
    const b = getBrowserWallet();
    if (!b) throw new Error("Connect your wallet first");
    return { kind: "browser", owner: b.address, wallet: b.wallet };
  }
  const { pubkey, secretKey } = localSolanaSigner(walletId);
  return { kind: "local", owner: pubkey, secretKey };
}

export async function executeLocalTrade(body: TradeBody): Promise<{ signature: string; region: string }> {
  if (getActiveChain() !== "sol") {
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
