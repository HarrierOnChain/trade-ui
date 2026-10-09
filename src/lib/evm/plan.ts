/**
 * A terminal trade on an EVM chain → the EVM router swap that carries it
 * out. The EVM router quotes exact-in only: a buy spends an amount of the
 * quote currency (the chain's native coin or a quote token), a sell spends
 * tokens (an amount or a share of the holding). Pure: the chain reads come in
 * through `io`, so the tests drive it with fixed numbers.
 */
import type { TradeBody } from "../swap/plan";

/** `native`, or a token's 0x address. */
export type EvmToken = string;

export interface EvmSwapPlan {
  tokenIn: EvmToken;
  tokenOut: EvmToken;
  /** raw units of `tokenIn` */
  amountIn: bigint;
}

export interface EvmPlanIo {
  decimals(token: EvmToken): Promise<number>;
  balanceRaw(token: EvmToken): Promise<bigint>;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** The native coin of every chain the EVM router serves has 18 decimals. */
const NATIVE_DECIMALS = 18;

export const EXACT_OUT_EVM =
  "On EVM chains the router quotes exact amounts in: enter what to spend (buy) or what to sell";

/** `n` UI units → raw, through its decimal text (0.1 ETH = 10^17). */
function uiToRaw(n: number, decimals: number): bigint {
  const t = n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return 0n;
  return BigInt(m[1] + (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0"));
}

const positive = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

function token(address: string | undefined, what: string): EvmToken {
  if (!address) return "native";
  if (!ADDRESS.test(address)) throw new Error(`${what} is not a token of this chain`);
  return address.toLowerCase();
}

export async function planEvmTrade(body: TradeBody, io: EvmPlanIo): Promise<EvmSwapPlan> {
  if (body.swapMode === "exactOut") throw new Error(EXACT_OUT_EVM);
  if (!ADDRESS.test(body.mint)) throw new Error("This token is not on an EVM chain");
  const mint = body.mint.toLowerCase();

  if (body.side === "buy") {
    const tokenIn = token(body.inputMint, "The quote currency");
    let amountIn = 0n;
    if (tokenIn !== "native" && positive(body.inputAmountRaw)) amountIn = BigInt(Math.floor(body.inputAmountRaw));
    else if (positive(body.solAmount)) {
      amountIn = uiToRaw(body.solAmount, tokenIn === "native" ? NATIVE_DECIMALS : await io.decimals(tokenIn));
    }
    if (amountIn <= 0n) throw new Error("Enter an amount");
    if (tokenIn === mint) throw new Error("Input and output are the same token");
    return { tokenIn, tokenOut: mint, amountIn };
  }

  const tokenOut = token(body.outputMint, "The quote currency");
  if (tokenOut === mint) throw new Error("Input and output are the same token");
  let amountIn = 0n;
  if (positive(body.percentage)) {
    const bps = BigInt(Math.round(Math.min(100, body.percentage) * 100));
    const held = await io.balanceRaw(mint);
    if (held <= 0n) throw new Error("Nothing to sell");
    // 100% is the whole balance, to the last unit.
    amountIn = bps >= 10_000n ? held : (held * bps) / 10_000n;
  } else if (positive(body.tokensAmount)) {
    amountIn = uiToRaw(body.tokensAmount, await io.decimals(mint));
  }
  if (amountIn <= 0n) throw new Error("Amount too small");
  return { tokenIn: mint, tokenOut, amountIn };
}
