/**
 * A terminal trade (the body the trading panel and the quick-buy / quick-sell
 * hooks send) → the router swap that carries it out. Pure: the chain reads
 * come in through `io`, so the tests drive it with fixed numbers.
 */

export interface TradeBody {
  walletId: string;
  side: "buy" | "sell";
  /** the token being bought or sold */
  mint: string;
  /** buy, exact-in: the SOL to spend; sell, exact-out: the quote amount to receive */
  solAmount?: number;
  /** sell: the share of the holding, 0–100 */
  percentage?: number;
  /** buy, exact-out: the tokens to receive; sell, exact-in: the tokens to sell */
  tokensAmount?: number;
  slippageBps?: number;
  /** the priority fee, total lamports */
  transactionsFeeLamports?: number;
  /** buy: pay with this quote token instead of SOL */
  inputMint?: string;
  /** buy, exact-in with `inputMint`: the amount in its raw units */
  inputAmountRaw?: number;
  /** sell: receive this quote token instead of SOL */
  outputMint?: string;
  swapMode?: "exactIn" | "exactOut";
}

export interface SwapPlan {
  inputMint: string;
  outputMint: string;
  /** raw units of the input (ExactIn) or of the output (ExactOut) */
  amount: bigint;
  swapMode: "ExactIn" | "ExactOut";
}

export interface PlanIo {
  decimals(mint: string): Promise<number>;
  balanceRaw(mint: string): Promise<bigint>;
}

const SOL = "So11111111111111111111111111111111111111112";

/** `n` UI units → raw, through its decimal text (0.1 SOL = 100,000,000). */
function uiToRaw(n: number, decimals: number): bigint {
  const t = n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return 0n;
  return BigInt(m[1] + (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0"));
}

const positive = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export async function planTrade(body: TradeBody, io: PlanIo): Promise<SwapPlan> {
  const exactOut = body.swapMode === "exactOut";
  if (body.side === "buy") {
    const inputMint = body.inputMint || SOL;
    const outputMint = body.mint;
    if (exactOut) {
      if (!positive(body.tokensAmount)) throw new Error("Enter how many tokens to buy");
      const amount = uiToRaw(body.tokensAmount, await io.decimals(outputMint));
      return { inputMint, outputMint, amount, swapMode: "ExactOut" };
    }
    let amount = 0n;
    if (body.inputMint && positive(body.inputAmountRaw)) amount = BigInt(Math.floor(body.inputAmountRaw));
    else if (positive(body.solAmount)) amount = uiToRaw(body.solAmount, await io.decimals(inputMint));
    if (amount <= 0n) throw new Error("Enter an amount");
    return { inputMint, outputMint, amount, swapMode: "ExactIn" };
  }

  const inputMint = body.mint;
  const outputMint = body.outputMint || SOL;
  if (exactOut) {
    if (!positive(body.solAmount)) throw new Error("Enter how much to receive");
    const amount = uiToRaw(body.solAmount, await io.decimals(outputMint));
    return { inputMint, outputMint, amount, swapMode: "ExactOut" };
  }
  let amount = 0n;
  if (positive(body.percentage)) {
    const bps = BigInt(Math.round(Math.min(100, body.percentage) * 100));
    const held = await io.balanceRaw(inputMint);
    if (held <= 0n) throw new Error("Nothing to sell");
    // 100% is the whole balance, to the last unit.
    amount = bps >= 10_000n ? held : (held * bps) / 10_000n;
  } else if (positive(body.tokensAmount)) {
    amount = uiToRaw(body.tokensAmount, await io.decimals(inputMint));
  }
  if (amount <= 0n) throw new Error("Amount too small");
  return { inputMint, outputMint, amount, swapMode: "ExactIn" };
}
