/**
 * The swap path in the browser: the router's quote read as the UI shows it,
 * what the quote and RPC routes forward, a terminal trade turned into a swap,
 * and what a failed swap says. The build, the signature and the send are the
 * server's (server/solana.mjs, tested in test/solana.test.mjs).
 * Run: `npm test` from trade-ui/. Kept out of tsconfig like trades.test.ts:
 * Node needs the `.ts` extension in the imports below.
 *
 * Fixtures: real answers of router.raze.bot (2026-10-04), unsigned, never sent.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  classifyQuoteError,
  swapErrorText,
  numberToRaw,
  splitLegs,
  toQuoteView,
  toRaw,
  viaLabel,
  type RouterQuote,
} from "./quote.ts";
import { rpcRequest } from "./validate.ts";
import { planTrade, type PlanIo } from "./plan.ts";

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const quoteFixture = fixture("quote-sol-usdc.json") as RouterQuote;

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

describe("quote", () => {
  test("maps the router's real SOL → USDC quote", () => {
    const v = toQuoteView(quoteFixture);
    assert.equal(v.inAmount, 10_000_000n);
    assert.equal(v.outAmount, 1_214_719n);
    assert.equal(v.threshold, BigInt(quoteFixture.otherAmountThreshold));
    assert.equal(v.swapMode, "ExactIn");
    assert.equal(v.legs.length, 1);
    assert.equal(v.legs[0].bps, 10_000);
    assert.equal(viaLabel(v), "Meteora DLMM");
    assert.equal(v.raw, quoteFixture);
  });

  test("reads priceImpactPct as a fraction", () => {
    assert.equal(toQuoteView({ ...quoteFixture, priceImpactPct: "0.0123" }).priceImpactBps, 123);
    assert.equal(toQuoteView({ ...quoteFixture, priceImpactPct: "x" }).priceImpactBps, 0);
  });

  test("cuts a split plan where a step reaches the output mint", () => {
    const hop = (label: string, i: string, o: string, a: string, b: string) => ({
      ammKey: `${label.replace(/\W/g, "")}Pool`,
      label,
      inputMint: i,
      outputMint: o,
      inAmount: a,
      outAmount: b,
    });
    const legs = splitLegs({
      ...quoteFixture,
      inputMint: SOL,
      outputMint: BONK,
      routePlan: [
        { swapInfo: hop("SolFi V2", SOL, USDC, "400", "48"), percent: 40, bps: 4000 },
        { swapInfo: hop("Raydium CLMM", USDC, BONK, "48", "1000") },
        { swapInfo: hop("PumpSwap", SOL, BONK, "600", "1600"), percent: 60, bps: 6000 },
      ],
    });
    assert.equal(legs.length, 2);
    assert.deepEqual(legs.map((l) => l.bps), [4000, 6000]);
    assert.deepEqual(legs.map((l) => l.outAmount), [1000n, 1600n]);
    assert.deepEqual(legs[0].hops.map((h) => h.dex), ["SolFi V2", "Raydium CLMM"]);
  });

  test("tells a missing route from a router that is busy", () => {
    assert.equal(classifyQuoteError(404, { reason: "no_route" }).kind, "noroute");
    assert.equal(classifyQuoteError(422, { reason: "low_liquidity" }).message, "Only dust pools");
    assert.equal(classifyQuoteError(422, { reason: "stale" }).kind, "transient");
    assert.equal(classifyQuoteError(503, {}).kind, "transient");
    assert.equal(classifyQuoteError(400, { reason: "zero_amount" }).message, "Amount too small");
  });

  test("UI amounts become exact raw units", () => {
    assert.equal(toRaw("0.1", 9), 100_000_000n);
    assert.equal(toRaw("1.123456789123", 6), 1_123_456n);
    assert.equal(toRaw("0", 9), null);
    assert.equal(toRaw("1e5", 9), null);
    assert.equal(numberToRaw(0.1, 9), 100_000_000n);
    assert.equal(numberToRaw(0.3, 6), 300_000n);
  });
});

describe("what the server forwards", () => {
  test("the RPC proxy forwards only the reads a trade needs", () => {
    assert.deepEqual(rpcRequest({ method: "getBalance", params: ["x"] }), { method: "getBalance", params: ["x"] });
    assert.equal("error" in rpcRequest({ method: "sendTransaction", params: ["x"] }), true);
    assert.equal("error" in rpcRequest({ method: "requestAirdrop", params: [] }), true);
    assert.equal("error" in rpcRequest({ method: "getProgramAccounts", params: [] }), true);
  });
});

describe("a terminal trade as a router swap", () => {
  const io = (balance = 0n, decimals: Record<string, number> = {}): PlanIo => ({
    decimals: async (m) => decimals[m] ?? (m === SOL ? 9 : m === USDC ? 6 : 6),
    balanceRaw: async () => balance,
  });
  const base = { walletId: "w", mint: BONK };

  test("buy with SOL, exact in", async () => {
    assert.deepEqual(await planTrade({ ...base, side: "buy", solAmount: 0.1 }, io()), {
      inputMint: SOL, outputMint: BONK, amount: 100_000_000n, swapMode: "ExactIn",
    });
  });

  test("buy with USDC from raw units", async () => {
    assert.deepEqual(await planTrade({ ...base, side: "buy", inputMint: USDC, inputAmountRaw: 2_500_000 }, io()), {
      inputMint: USDC, outputMint: BONK, amount: 2_500_000n, swapMode: "ExactIn",
    });
  });

  test("buy an exact token amount", async () => {
    assert.deepEqual(await planTrade({ ...base, side: "buy", swapMode: "exactOut", tokensAmount: 1000 }, io(0n, { [BONK]: 5 })), {
      inputMint: SOL, outputMint: BONK, amount: 100_000_000n, swapMode: "ExactOut",
    });
  });

  test("sell a share of the holding; 100% is every last unit", async () => {
    const held = 123_456_789n;
    assert.equal((await planTrade({ ...base, side: "sell", percentage: 100 }, io(held))).amount, held);
    assert.equal((await planTrade({ ...base, side: "sell", percentage: 50 }, io(held))).amount, 61_728_394n);
    assert.equal((await planTrade({ ...base, side: "sell", percentage: 25, outputMint: USDC }, io(held))).outputMint, USDC);
    await assert.rejects(planTrade({ ...base, side: "sell", percentage: 50 }, io(0n)), /Nothing to sell/);
  });

  test("sell for an exact amount of SOL", async () => {
    assert.deepEqual(await planTrade({ ...base, side: "sell", swapMode: "exactOut", solAmount: 0.5 }, io()), {
      inputMint: BONK, outputMint: SOL, amount: 500_000_000n, swapMode: "ExactOut",
    });
  });

  test("no amount, no trade", async () => {
    await assert.rejects(planTrade({ ...base, side: "buy" }, io()), /Enter an amount/);
    await assert.rejects(planTrade({ ...base, side: "sell" }, io(10n)), /too small/);
  });
});

describe("what a failed swap says", () => {
  const rpc = (err: unknown) => new Error(`Transaction simulation failed (${JSON.stringify(err)})`);
  test("the swap program's floor, cap and deadline", () => {
    const at = (n: number) => rpc({ InstructionError: [3, { Custom: 0x5357_0000 + n }] });
    assert.match(swapErrorText(at(14)), /slippage/);
    assert.match(swapErrorText(at(15)), /slippage/);
    assert.match(swapErrorText(at(6)), /expired/);
  });
  test("balance, refusal, and anything else as it came", () => {
    assert.match(swapErrorText(rpc("AccountNotFound")), /no SOL yet/);
    assert.match(swapErrorText(rpc({ InstructionError: [4, { Custom: 1 }] })), /Not enough balance/);
    assert.match(swapErrorText(rpc("InsufficientFundsForRent")), /Not enough balance/);
    assert.equal(swapErrorText(new Error("User rejected the request.")), "Rejected in wallet");
    assert.equal(swapErrorText(new Error("router unavailable (502)")), "router unavailable (502)");
  });
});
