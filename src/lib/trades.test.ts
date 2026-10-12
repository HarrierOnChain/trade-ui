/**
 * Row identity and merge rules of the trade lists: rows are keyed on the
 * API's `id` (the same on REST pages, the trades snapshot, live frames and
 * retracts).
 * Run: `npm test` (or `node --test src/lib/trades.test.ts`) from trade-ui/.
 * Kept out of tsconfig, like candleDespike.parity.test.ts: Node needs the
 * `.ts` extension in the import below.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addLiveTrade,
  appendTradePage,
  applyTradeTags,
  dropRetracted,
  mergeTradeBatch,
  mergeTradeLists,
  tradeIdentityKey,
  tradeKey,
  tradeKeyAcrossTokens,
  tradeNative,
} from "./trades.ts";
import type { Trade } from "../types";

const MINT = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const SIG2 = "4hXTCkRzt9WyecNzV1XPgCDfGAZzQKNxLXgynz5QDuWWPSAZBZSHptvWRL3BjCvzUXRdKvHL2b5yV6vjqYsLjvSD";
const OWNER = "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH";
const COSIGNER = "Bv2xTxD3nrvXyWCkPjQZz6mLyzK9WbjPyzrmCF5Fr8pM";

const EVM_TX = "0xabc0000000000000000000000000000000000000000000000000000000000001";
const EVM_MAKER = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed";

function trade(over: Partial<Trade>): Trade {
  return {
    id: `${SIG}:${OWNER}`,
    signature: SIG,
    tokenMint: MINT,
    signer: OWNER,
    transactionType: "buy",
    tokensAmount: 1000,
    avgPrice: 0.000001,
    solAmount: 0.001,
    timestamp: 1_759_400_000_000,
    ...over,
  };
}

const ids = (rows: Trade[]) => rows.map((t) => t.id);

// ── identity ──────────────────────────────────────────────────────────

test("a row is its id; one the UI made falls back to signature and wallet", () => {
  assert.equal(tradeKey(trade({ id: "a" })), "a");
  assert.equal(tradeKey(trade({ id: undefined })), `${SIG}:${OWNER}`);
});

test("on EVM two swap logs of one wallet in one transaction are two rows", () => {
  const a = trade({ id: `${EVM_TX}:3`, signature: EVM_TX, signer: EVM_MAKER });
  const b = trade({ id: `${EVM_TX}:7`, signature: EVM_TX, signer: EVM_MAKER });
  assert.notEqual(tradeKey(a), tradeKey(b));
  assert.equal(mergeTradeBatch([], [a, b]).length, 2);
});

test("a token-to-token swap is one row per token in a wallet's list", () => {
  const sell = trade({ transactionType: "sell", tokenMint: MINT });
  const buy = trade({ transactionType: "buy", tokenMint: "SAPL1NGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" });
  assert.notEqual(tradeKeyAcrossTokens(sell), tradeKeyAcrossTokens(buy));
  assert.notEqual(tradeIdentityKey(sell), tradeIdentityKey(buy));
});

test("unknown volume stays unknown", () => {
  assert.equal(tradeNative(trade({ solAmount: null })), null);
  assert.equal(tradeNative(trade({ solAmount: Number.NaN })), null);
  assert.equal(tradeNative(trade({ solAmount: 0.25 })), 0.25);
});

// ── a batch (REST page, WS snapshot) against what the list holds ───────

test("a batch replaces the rows it holds by id and adds the others", () => {
  let rows = addLiveTrade([], trade({ id: "a", solAmount: 0.1 }));
  rows = mergeTradeBatch(rows, [trade({ id: "a", solAmount: 0.2 }), trade({ id: "b" })]);
  assert.deepEqual(ids(rows), ["a", "b"]);
  assert.equal(rows[0].solAmount, 0.2);
});

test("co-signers of one transaction are two rows", () => {
  let rows = addLiveTrade([], trade({ id: `${SIG}:${OWNER}` }));
  rows = addLiveTrade(rows, trade({ id: `${SIG}:${COSIGNER}`, signer: COSIGNER }));
  assert.equal(rows.length, 2);
  rows = mergeTradeBatch(rows, [trade({ id: `${SIG}:${OWNER}` }), trade({ id: `${SIG}:${COSIGNER}`, signer: COSIGNER })]);
  assert.equal(rows.length, 2);
});

test("an exact duplicate inside one batch is one row", () => {
  const t = trade({});
  assert.equal(mergeTradeBatch([], [t, { ...t }]).length, 1);
});

// ── live frames ───────────────────────────────────────────────────────

test("the same live frame twice (socket and SSE) is one row and changes nothing", () => {
  const f = trade({ tags: ["mev"] });
  const rows = addLiveTrade([], f);
  assert.equal(rows.length, 1);
  assert.equal(addLiveTrade(rows, { ...f }), rows);
});

test("a later copy of a row (the frame of a row a page holds) updates it in place", () => {
  const rows = mergeTradeBatch([], [trade({ id: "a", tags: [] })]);
  const after = addLiveTrade(rows, trade({ id: "a", tags: ["mev"], isProTrader: true }));
  assert.equal(after.length, 1);
  assert.deepEqual(after[0].tags, ["mev"]);
  assert.equal(after[0].isProTrader, true);
});

test("a tags frame replaces the tags of the rows it names", () => {
  const rows = mergeTradeBatch([], [trade({ id: "a", tags: ["bundle"], isBundle: true }), trade({ id: "b" })]);
  const after = applyTradeTags(rows, [{ id: "a", tags: ["sniper"] }]);
  assert.deepEqual(after[0].tags, ["sniper"]);
  assert.equal(after[0].isBundle, false);
  assert.equal(after[0].isSniper, true);
  assert.equal(after[1], rows[1]);
  assert.equal(applyTradeTags(rows, [{ id: "zzz", tags: ["sniper"] }]), rows);
});

// ── lists merged for display ──────────────────────────────────────────

test("display merge takes a row from the first list that has it", () => {
  const demo = [trade({ id: "a", solAmount: 0.002 })];
  const tape = [trade({ id: "a", solAmount: 0.001 }), trade({ id: "b" })];
  const rows = mergeTradeLists(demo, tape);
  assert.deepEqual(ids(rows), ["a", "b"]);
  assert.equal(rows[0].solAmount, 0.002);
});

// ── wallet pages ──────────────────────────────────────────────────────

const page = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => trade({ id: `row-${from + i}` }));

test("a wallet page adds the rows not held", () => {
  const first = appendTradePage([], page(50), { cap: 500 });
  assert.equal(first.length, 50);
  assert.equal(appendTradePage(first, page(50), { cap: 500 }).length, 50);
  assert.equal(appendTradePage(first, page(10, 45), { cap: 500 }).length, 55);
});

test("wallet pages stop at the cap", () => {
  let rows: Trade[] = [];
  for (let p = 0; p < 12; p++) rows = appendTradePage(rows, page(50, p * 50), { cap: 500 });
  assert.equal(rows.length, 500);
});

// ── retracted slots ───────────────────────────────────────────────────

test("a retract drops the named rows only, and the copy then comes in as new", () => {
  const voided = trade({ id: `${SIG}:${OWNER}`, live: true, solAmount: 0.5 });
  const cosigner = trade({ id: `${SIG}:${COSIGNER}`, live: true, signer: COSIGNER });
  const other = trade({ id: `${SIG2}:${OWNER}`, signature: SIG2, live: true });
  const prev = [voided, cosigner, other];
  const after = dropRetracted(prev, [{ id: `${SIG}:${OWNER}` }]);
  assert.deepEqual(ids(after), [`${SIG}:${COSIGNER}`, `${SIG2}:${OWNER}`]);
  const copy = trade({ id: `${SIG}:${OWNER}`, solAmount: 0.45 });
  const withCopy = addLiveTrade(after, copy);
  assert.equal(withCopy.length, 3);
  assert.equal(withCopy[0].solAmount, 0.45);
});

test("a retract naming nothing held keeps the list", () => {
  const prev = [trade({}), trade({ id: "b" })];
  assert.equal(dropRetracted(prev, [{ id: "nope" }]), prev);
  assert.equal(dropRetracted(prev, []), prev);
});
