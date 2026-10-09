/**
 * One EVM trade, end to end: the trade planned against the wallet's balances
 * (src/lib/evm/plan.ts), a quote from the EVM router through Trade UI's
 * server, which keeps it and hands out a token (server/evm.mjs); the server
 * then builds exactly that quote for the wallet, checks and signs the
 * approvals and the swap with the key in the vault and sends them; the
 * server also waits for the swap's receipt. The key never reaches the
 * browser, and the browser cannot alter the quote it trades.
 */
import type { ChainId } from "../chains";
import type { TradeBody } from "../swap/plan";
import { evmRoutes, vault } from "../vault/client";
import { evmWallet } from "../../api/vaultWallets";
import { planEvmTrade, type EvmToken } from "./plan";

const DEFAULT_SLIPPAGE_BPS = 100;

/** Decimals do not change: read once per token and page load. */
const decimalsCache = new Map<string, Promise<number>>();

export function evmDecimals(chain: ChainId, token: EvmToken): Promise<number> {
  const key = `${chain}:${token}`;
  let p = decimalsCache.get(key);
  if (!p) {
    p = evmRoutes.balance(chain, "", token).then((b) => b.decimals);
    decimalsCache.set(key, p);
    p.catch(() => decimalsCache.delete(key));
  }
  return p;
}

export async function executeEvmTrade(chain: ChainId, body: TradeBody): Promise<{ signature: string }> {
  const w = evmWallet(body.walletId);
  const plan = await planEvmTrade(body, {
    decimals: (token) => evmDecimals(chain, token),
    balanceRaw: async (token) => BigInt((await evmRoutes.balance(chain, w.address, token)).raw ?? "0"),
  });
  const slippageBps = Number.isFinite(body.slippageBps) ? Math.max(0, Math.round(body.slippageBps!)) : DEFAULT_SLIPPAGE_BPS;
  const quote = await evmRoutes.quote({
    chain,
    tokenIn: plan.tokenIn,
    tokenOut: plan.tokenOut,
    amountIn: plan.amountIn.toString(),
    slippageBps,
  });
  const { signature } = await vault.swap(w.id, quote.quoteToken);
  await evmRoutes.confirm(chain, signature);
  return { signature };
}
