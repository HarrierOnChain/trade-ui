/**
 * A terminal trade on an EVM chain turned into the EVM router's exact-in
 * swap. Run: `npm test` from trade-ui/. Kept out of tsconfig like the other
 * browser tests: Node needs the `.ts` extension in the import below.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { EXACT_OUT_EVM, planEvmTrade, type EvmPlanIo } from "./plan.ts";

const TOKEN = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed"; // DEGEN on Base, 18 decimals
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // 6 decimals

const io = (held: bigint): EvmPlanIo & { reads: string[] } => {
  const reads: string[] = [];
  return {
    reads,
    async decimals(t) {
      reads.push(`decimals ${t}`);
      return t === USDC.toLowerCase() ? 6 : 18;
    },
    async balanceRaw(t) {
      reads.push(`balance ${t}`);
      return held;
    },
  };
};

const base = { walletId: "w_1", mint: TOKEN, slippageBps: 100 };

describe("EVM trade plan", () => {
  test("a buy spends the native coin, 18 decimals, without a read", async () => {
    const r = io(0n);
    const p = await planEvmTrade({ ...base, side: "buy", solAmount: 0.1 }, r);
    assert.deepEqual(p, { tokenIn: "native", tokenOut: TOKEN.toLowerCase(), amountIn: 100_000_000_000_000_000n });
    assert.deepEqual(r.reads, []);
  });

  test("a buy paid in a quote token: its raw amount, or its UI amount in its decimals", async () => {
    let p = await planEvmTrade({ ...base, side: "buy", inputMint: USDC, inputAmountRaw: 25_000_000 }, io(0n));
    assert.deepEqual(p, { tokenIn: USDC.toLowerCase(), tokenOut: TOKEN.toLowerCase(), amountIn: 25_000_000n });
    p = await planEvmTrade({ ...base, side: "buy", inputMint: USDC, solAmount: 2.5 }, io(0n));
    assert.equal(p.amountIn, 2_500_000n);
  });

  test("a sell: a share of the holding (all of it at 100 %) or a token amount", async () => {
    let p = await planEvmTrade({ ...base, side: "sell", percentage: 50 }, io(1_001n));
    assert.deepEqual(p, { tokenIn: TOKEN.toLowerCase(), tokenOut: "native", amountIn: 500n });
    p = await planEvmTrade({ ...base, side: "sell", percentage: 100 }, io(1_001n));
    assert.equal(p.amountIn, 1_001n);
    p = await planEvmTrade({ ...base, side: "sell", tokensAmount: 1.5, outputMint: USDC }, io(0n));
    assert.deepEqual(p, { tokenIn: TOKEN.toLowerCase(), tokenOut: USDC.toLowerCase(), amountIn: 1_500_000_000_000_000_000n });
  });

  test("what the router cannot do is said, not guessed", async () => {
    await assert.rejects(planEvmTrade({ ...base, side: "buy", swapMode: "exactOut", tokensAmount: 5 }, io(0n)), { message: EXACT_OUT_EVM });
    await assert.rejects(planEvmTrade({ ...base, side: "sell", percentage: 10 }, io(0n)), /Nothing to sell/);
    await assert.rejects(planEvmTrade({ ...base, side: "buy" }, io(0n)), /Enter an amount/);
    // A Solana quote mint left in the settings is not a token of this chain.
    await assert.rejects(
      planEvmTrade({ ...base, side: "buy", inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", solAmount: 1 }, io(0n)),
      /not a token of this chain/,
    );
    await assert.rejects(planEvmTrade({ ...base, mint: "So11111111111111111111111111111111111111112", side: "buy", solAmount: 1 }, io(0n)), /not on an EVM chain/);
    await assert.rejects(planEvmTrade({ ...base, side: "sell", outputMint: TOKEN, percentage: 10 }, io(5n)), /same token/);
  });
});
