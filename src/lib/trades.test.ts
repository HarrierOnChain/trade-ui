/**
 * Row identity and merge rules of the trade lists.
 * Run: `npm test` (or `node --test src/lib/trades.test.ts`) from trade-ui/.
 * Kept out of tsconfig, like candleDespike.parity.test.ts: Node needs the
 * `.ts` extension in the import below.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addLiveTrade,
  appendTradePage,
  mergeTradeBatch,
  mergeTradeLists,
  tradeKey,
  tradeKeyAcrossTokens,
  tradeLegKey,
  tradeLegKeyAcrossTokens,
  tradeNative,
} from "./trades.ts";
import type { Trade } from "../types";

const MINT = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const SIG2 = "4hXTCkRzt9WyecNzV1XPgCDfGAZzQKNxLXgynz5QDuWWPSAZBZSHptvWRL3BjCvzUXRdKvHL2b5yV6vjqYsLjvSD";
const FEE_PAYER = "7Ppgch9d4XRAygVNJP4bDkc7V6htYXGfghX4zzG9r4cH";
const OWNER = "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH";
const COSIGNER = "Bv2xTxD3nrvXyWCkPjQZz6mLyzK9WbjPyzrmCF5Fr8pM";

const EVM_TX = "0xAbC0000000000000000000000000000000000000000000000000000000000001";
const EVM_MAKER = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const EVM_TOKEN = "0x6b175474e89094c44da98b954eedeac495271d0f";

function trade(over: Partial<Trade>): Trade {
  return {
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

const wallets = (rows: Trade[]) => rows.map((t) => t.signer);

// ── identity ──────────────────────────────────────────────────────────

test("co-signers of one transaction are two identities", () => {
  assert.notEqual(tradeKey(trade({ signer: OWNER })), tradeKey(trade({ signer: COSIGNER })));
});

test("EVM keys ignore case, base58 keys do not", () => {
  assert.equal(
    tradeKey(trade({ signature: EVM_TX, signer: EVM_MAKER })),
    tradeKey(trade({ signature: EVM_TX.toLowerCase(), signer: EVM_MAKER.toLowerCase() })),
  );
  assert.notEqual(tradeKey(trade({ signer: OWNER })), tradeKey(trade({ signer: OWNER.toLowerCase() })));
});

test("on EVM two swap logs of one wallet in one transaction are two legs", () => {
  const a = trade({ signature: EVM_TX, signer: EVM_MAKER, solAmount: 0.4, tokensAmount: 400 });
  const b = trade({ signature: EVM_TX, signer: EVM_MAKER, solAmount: 0.6, tokensAmount: 590 });
  assert.equal(tradeKey(a), tradeKey(b));
  assert.notEqual(tradeLegKey(a), tradeLegKey(b));
});

test("a token-to-token swap is one row per token in a wallet's list", () => {
  const sell = trade({ transactionType: "sell", tokenMint: MINT });
  const buy = trade({ transactionType: "buy", tokenMint: "SAPL1NGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" });
  assert.notEqual(tradeKeyAcrossTokens(sell), tradeKeyAcrossTokens(buy));
  assert.notEqual(tradeLegKeyAcrossTokens(sell), tradeLegKeyAcrossTokens(buy));
});

test("unknown volume stays unknown", () => {
  assert.equal(tradeNative(trade({ solAmount: null })), null);
  assert.equal(tradeNative(trade({ solAmount: Number.NaN })), null);
  assert.equal(tradeNative(trade({ solAmount: 0.25 })), 0.25);
});

// ── a batch (REST page, WS snapshot) against what the list holds ───────

test("a snapshot naming another wallet for a live swap replaces it, not doubles it", () => {
  // The firehose names the owner whose balance moved; GMGN names the fee payer.
  const live = addLiveTrade([], trade({ signer: OWNER }));
  const merged = mergeTradeBatch(live, [trade({ signer: FEE_PAYER })]);
  assert.deepEqual(wallets(merged), [FEE_PAYER]);
});

test("a live frame for a swap an API answer already holds is not added", () => {
  const held = mergeTradeBatch([], [trade({ signer: FEE_PAYER })]);
  const after = addLiveTrade(held, trade({ signer: OWNER }));
  assert.deepEqual(wallets(after), [FEE_PAYER]);
});

test("co-signer rows survive live frames, a snapshot and a REST page", () => {
  let rows = addLiveTrade([], trade({ signer: OWNER }));
  rows = addLiveTrade(rows, trade({ signer: COSIGNER }));
  assert.deepEqual(new Set(wallets(rows)), new Set([OWNER, COSIGNER]));
  rows = mergeTradeBatch(rows, [trade({ signer: OWNER }), trade({ signer: COSIGNER })]);
  assert.equal(rows.length, 2);
  rows = mergeTradeBatch(rows, [trade({ signer: OWNER }), trade({ signer: COSIGNER }), trade({ signature: SIG2 })]);
  assert.equal(rows.length, 3);
});

test("rows of other transactions are kept when a batch arrives", () => {
  const rows = addLiveTrade([], trade({ signature: SIG2, signer: COSIGNER }));
  const merged = mergeTradeBatch(rows, [trade({ signer: FEE_PAYER })]);
  assert.deepEqual(new Set(merged.map((t) => t.signature)), new Set([SIG, SIG2]));
});

test("the same live frame twice (socket and SSE) is one row", () => {
  const f = trade({});
  assert.equal(addLiveTrade(addLiveTrade([], f), { ...f }).length, 1);
  const e = trade({ signature: EVM_TX, signer: EVM_MAKER });
  assert.equal(addLiveTrade(addLiveTrade([], e), { ...e }).length, 1);
});

test("EVM: both legs of a split route survive a batch", () => {
  const legs = [
    trade({ signature: EVM_TX, signer: EVM_MAKER, tokenMint: EVM_TOKEN, solAmount: 0.4, tokensAmount: 400 }),
    trade({ signature: EVM_TX, signer: EVM_MAKER, tokenMint: EVM_TOKEN, solAmount: 0.6, tokensAmount: 590 }),
  ];
  const rows = mergeTradeBatch([], legs);
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((s, t) => s + (t.solAmount ?? 0), 0), 1.0);
});

test("EVM: a buy and a sell leg through the token in one transaction both survive", () => {
  const legs = [
    trade({ signature: EVM_TX, signer: EVM_MAKER, transactionType: "buy", solAmount: 0.5, tokensAmount: 500 }),
    trade({ signature: EVM_TX, signer: EVM_MAKER, transactionType: "sell", solAmount: 0.5, tokensAmount: 500 }),
  ];
  assert.equal(mergeTradeBatch([], legs).length, 2);
  assert.equal(addLiveTrade(addLiveTrade([], legs[0]), legs[1]).length, 2);
});

test("an exact duplicate inside one batch is one row", () => {
  const t = trade({});
  assert.equal(mergeTradeBatch([], [t, { ...t }]).length, 1);
});

// ── flags and tags learnt later ───────────────────────────────────────

test("tags a later snapshot carries reach the row already shown", () => {
  const rows = addLiveTrade([], trade({ tags: ["bundle"], isBundle: true }));
  const merged = mergeTradeBatch(rows, [trade({ tags: ["sniper", "insider"], isSniper: true })]);
  assert.equal(merged.length, 1);
  assert.deepEqual(new Set(merged[0].tags), new Set(["bundle", "sniper", "insider"]));
  assert.equal(merged[0].isBundle, true);
  assert.equal(merged[0].isSniper, true);
});

test("tags a later live frame carries reach the row already shown", () => {
  const rows = mergeTradeBatch([], [trade({ tags: [] })]);
  const after = addLiveTrade(rows, trade({ tags: ["mev"], isProTrader: true }));
  assert.equal(after.length, 1);
  assert.deepEqual(after[0].tags, ["mev"]);
  assert.equal(after[0].isProTrader, true);
});

test("a duplicate frame with nothing new leaves the list untouched", () => {
  const rows = addLiveTrade([], trade({ tags: ["mev"] }));
  assert.equal(addLiveTrade(rows, trade({ tags: ["mev"] })), rows);
});

// ── lists merged for display ──────────────────────────────────────────

test("display merge keeps the tape's EVM legs and gives each row a unique key", () => {
  const tape = mergeTradeBatch([], [
    trade({ signature: EVM_TX, signer: EVM_MAKER, solAmount: 0.4, tokensAmount: 400 }),
    trade({ signature: EVM_TX, signer: EVM_MAKER, solAmount: 0.6, tokensAmount: 590 }),
  ]);
  const extra = [trade({ signature: SIG2 })];
  const rows = mergeTradeLists(extra, tape);
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(tradeLegKey)).size, 3);
});

test("display merge drops a later list's copy of a row an earlier list has", () => {
  const demo = [trade({ solAmount: 0.002 })];
  const tape = [trade({ solAmount: 0.001 }), trade({ signer: COSIGNER })];
  const rows = mergeTradeLists(demo, tape);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].solAmount, 0.002);
});

// ── wallet pages ──────────────────────────────────────────────────────

const page = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => trade({ signature: `${SIG.slice(0, 80)}${String(from + i).padStart(8, "0")}` }));

test("a full wallet page keeps the list paging on scroll", () => {
  const r = appendTradePage([], page(50), { cap: 500, limit: 50 });
  assert.equal(r.rows.length, 50);
  assert.equal(r.autoMore, true);
});

test("an empty or sparse wallet page stops paging on scroll", () => {
  const first = appendTradePage([], page(50), { cap: 500, limit: 50 });
  assert.equal(appendTradePage(first.rows, [], { cap: 500, limit: 50 }).autoMore, false);
  assert.equal(appendTradePage(first.rows, page(3, 50), { cap: 500, limit: 50 }).autoMore, false);
  // A page of rows already held adds nothing either.
  assert.equal(appendTradePage(first.rows, page(50), { cap: 500, limit: 50 }).autoMore, false);
});

test("wallet pages stop at the cap", () => {
  let rows: Trade[] = [];
  for (let p = 0; p < 12; p++) rows = appendTradePage(rows, page(50, p * 50), { cap: 500, limit: 50 }).rows;
  assert.equal(rows.length, 500);
});
