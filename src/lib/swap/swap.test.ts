/**
 * The swap path: the router's quote read as the UI shows it, what the server
 * routes forward, the v0 re-assembly for wallets without v1, local signing of
 * the router's v1 transaction, and a terminal trade turned into a swap.
 * Run: `npm test` from trade-ui/. Kept out of tsconfig like trades.test.ts:
 * Node needs the `.ts` extension in the imports below.
 *
 * Fixtures: real answers of router.raze.bot (2026-10-04), unsigned, never sent.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  getBase58Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
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
import { quoteQuery, rpcRequest, swapBody } from "./validate.ts";
import { assembleV0, buildInstructions, buildKeyCount, readV1, V0_MAX_BYTES } from "./v0.ts";
import {
  b58encode,
  b64decode,
  b64encode,
  chooseTransaction,
  quoteReserveKeys,
  signLocal,
  V0_RESERVE_KEYS,
} from "./sign.ts";
import { planTrade, type PlanIo } from "./plan.ts";

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const quoteFixture = fixture("quote-sol-usdc.json") as RouterQuote;
// 0.01 SOL → USDC on Meteora DLMM for the docs' example wallet (25 keys).
const build = fixture("build-sol-usdc.json");
const WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
// 0.1 SOL → USDC on Raydium CLMM, unconstrained (37 keys).
const clmm = fixture("build-sol-usdc-clmm.json");
const CLMM_WALLET = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const CB = "ComputeBudget111111111111111111111111111111";

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
  const sp = (o: Record<string, string>) => new URLSearchParams(o);

  test("a quote keeps only the whitelisted parameters", () => {
    const r = quoteQuery(sp({
      inputMint: SOL, outputMint: USDC, amount: "1000", slippageBps: "50",
      swapMode: "ExactOut", excludeDexes: "SolFi V2, PumpSwap", reserveKeys: "39",
      feeAccount: "x", platformFeeBps: "100",
    }));
    assert.equal(
      r.query,
      `inputMint=${SOL}&outputMint=${USDC}&amount=1000&swapMode=ExactOut&slippageBps=50` +
        "&excludeDexes=SolFi+V2%2CPumpSwap&reserveKeys=39",
    );
  });

  test("a bad quote request is refused", () => {
    assert.equal(quoteQuery(sp({ inputMint: SOL, outputMint: SOL, amount: "1" })).error, "input and output are the same token");
    assert.equal(quoteQuery(sp({ inputMint: SOL, outputMint: USDC, amount: "0" })).error, "bad amount");
    assert.equal(quoteQuery(sp({ inputMint: SOL, outputMint: USDC, amount: "18446744073709551616" })).error, "bad amount");
    assert.equal(quoteQuery(sp({ inputMint: SOL, outputMint: USDC, amount: "1", swapMode: "Both" })).error, "bad swapMode");
    assert.equal(quoteQuery(sp({ inputMint: SOL, outputMint: USDC, amount: "1", reserveKeys: "64" })).error, "bad reserveKeys");
  });

  test("a build carries the trader's priority fee, or the router's capped estimate", () => {
    const own = swapBody({ wallet: WALLET, quote: quoteFixture, priorityFeeLamports: 100_000, v0: true }, { priorityMaxLamports: 500_000 });
    assert.equal(own.body?.prioritizationFeeLamports, 100_000);
    assert.equal(own.v0, true);
    const auto = swapBody({ wallet: WALLET, quote: quoteFixture }, { priorityMaxLamports: 500_000 });
    assert.deepEqual(auto.body?.prioritizationFeeLamports, { priorityLevelWithMaxLamports: { maxLamports: 500_000 } });
    assert.equal(auto.body?.userPublicKey, WALLET);
    assert.equal(auto.body?.quoteResponse, quoteFixture);
    assert.equal("feeAccount" in (auto.body ?? {}), false);
    assert.equal(swapBody({ wallet: WALLET, quote: quoteFixture, priorityFeeLamports: 1.5 }, { priorityMaxLamports: 1 }).error, "bad priorityFeeLamports");
    assert.equal(swapBody({ wallet: "nope", quote: quoteFixture }, { priorityMaxLamports: 1 }).error, "bad wallet");
    assert.equal(swapBody({ wallet: WALLET, quote: { ...quoteFixture, routePlan: [] } }, { priorityMaxLamports: 1 }).error, "bad quote");
  });

  test("the RPC proxy forwards only what a swap needs", () => {
    assert.deepEqual(rpcRequest({ method: "sendTransaction", params: ["x"] }), { method: "sendTransaction", params: ["x"] });
    assert.equal("error" in rpcRequest({ method: "requestAirdrop", params: [] }), true);
    assert.equal("error" in rpcRequest({ method: "getProgramAccounts", params: [] }), true);
  });
});

describe("v0 for wallets without v1", () => {
  const out = assembleV0(build, WALLET);
  const decode = (b64: string) =>
    getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(b64decode(b64)).messageBytes);

  test("reads the router's v1 transaction", () => {
    const v1 = readV1(build.swapTransaction);
    assert.equal(v1.version, 1);
    assert.equal(v1.feePayer, WALLET);
  });

  test("same payer and blockhash, the v1 header first as ComputeBudget instructions", () => {
    assert.ok(out.transaction);
    const msg = decode(out.transaction!);
    assert.equal(msg.version, 0);
    assert.equal(msg.staticAccounts[0], WALLET);
    assert.equal(msg.lifetimeToken, readV1(build.swapTransaction).blockhash);
    const cb = msg.instructions.slice(0, 3);
    for (const ix of cb) assert.equal(msg.staticAccounts[ix.programAddressIndex], CB);
    const data = cb.map((ix) => Buffer.from(ix.data ?? []));
    assert.equal(data[0][0], 2);
    assert.equal(data[0].readUInt32LE(1), build.transactionConfig.computeUnitLimit + 450);
    assert.equal(data[1][0], 3);
    assert.equal(data[1].readBigUInt64LE(1), BigInt(build.costs.priorityFeeMicroLamportsPerCu));
    assert.equal(data[2][0], 4);
    assert.equal(data[2].readUInt32LE(1), build.transactionConfig.loadedAccountsDataSizeLimit);
  });

  test("every instruction of the build, in order, byte for byte", () => {
    const msg = decode(out.transaction!);
    const want = buildInstructions(build);
    const got = msg.instructions.slice(3);
    assert.equal(got.length, want.length);
    got.forEach((ix, i) => {
      assert.equal(msg.staticAccounts[ix.programAddressIndex], want[i].programId);
      assert.equal(Buffer.from(ix.data ?? []).toString("base64"), want[i].data);
      assert.deepEqual((ix.accountIndices ?? []).map((a) => msg.staticAccounts[a]), (want[i].accounts ?? []).map((a) => a.pubkey));
    });
  });

  test("refuses a build for another fee payer", () => {
    assert.throws(() => assembleV0(build, "11111111111111111111111111111111"), /another fee payer/);
  });

  test("the key budget: 64 - reserveKeys keys fit, the 37-key CLMM route does not", () => {
    assert.equal(buildKeyCount(build), 64 - V0_RESERVE_KEYS);
    assert.ok(out.bytes! <= V0_MAX_BYTES);
    assert.ok(buildKeyCount(clmm) > 64 - V0_RESERVE_KEYS);
    const r = assembleV0(clmm, CLMM_WALLET);
    assert.equal(r.transaction, null);
    assert.equal(r.reason, "route needs 1601 bytes as v0 (max 1232)");
  });

  test("the wallet's declared versions pick the form", () => {
    assert.equal(quoteReserveKeys([1, 0, "legacy"]), undefined);
    assert.equal(quoteReserveKeys([0, "legacy"]), V0_RESERVE_KEYS);
    const b = { transaction: "V1", transactionV0: "V0", v0Unavailable: null };
    assert.deepEqual(chooseTransaction([1, 0], b), { version: 1, b64: "V1" });
    assert.deepEqual(chooseTransaction([0, "legacy"], b), { version: 0, b64: "V0" });
    const none = chooseTransaction([0], { ...b, transactionV0: null, v0Unavailable: "route needs 1601 bytes as v0 (max 1232)" });
    assert.ok("error" in none && /1601 bytes/.test(none.error));
    assert.ok("error" in chooseTransaction(["legacy"], b));
  });
});

describe("local signing of the router's v1 transaction", () => {
  // A keypair of our own, put in the fixture's fee-payer slot: the router's
  // real v1 bytes, for a wallet whose key this test holds.
  const seed = ed25519.utils.randomSecretKey();
  const pub = ed25519.getPublicKey(seed);
  const secretKey = new Uint8Array(64);
  secretKey.set(seed, 0);
  secretKey.set(pub, 32);
  const raw = b64decode(build.swapTransaction);
  const payer = Uint8Array.from(getBase58Encoder().encode(WALLET));
  const at = Buffer.from(raw).indexOf(Buffer.from(payer));
  const mine = Uint8Array.from(raw);
  mine.set(pub, at);
  const unsigned = b64encode(mine);

  test("fills the fee payer's slot with a valid signature, nothing else changes", () => {
    assert.ok(at > 0);
    const { signed, signature } = signLocal(unsigned, secretKey);
    const out = b64decode(signed);
    assert.equal(out.length, mine.length);
    const tx = getTransactionDecoder().decode(out);
    const sig = tx.signatures[b58encode(pub) as keyof typeof tx.signatures] as Uint8Array;
    assert.equal(b58encode(sig), signature);
    assert.ok(ed25519.verify(sig, Uint8Array.from(tx.messageBytes), pub));
    // v1: the message first, the 64-byte slot after it
    assert.deepEqual(out.subarray(0, mine.length - 64), mine.subarray(0, mine.length - 64));
    assert.deepEqual(out.subarray(mine.length - 64), sig);
  });

  test("refuses a transaction built for another wallet", () => {
    assert.throws(() => signLocal(build.swapTransaction, secretKey), /another wallet/);
  });

  test("refuses a key whose halves do not match", () => {
    const bad = Uint8Array.from(secretKey);
    bad[40] ^= 1;
    assert.throws(() => signLocal(unsigned, bad), /does not match/);
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
