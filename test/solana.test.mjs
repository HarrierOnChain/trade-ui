/**
 * The server side of a swap and a transfer. Fixtures: real answers of
 * router.raze.bot (2026-10-04), unsigned, never sent.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { fromBase58, generateKey, toBase58 } from "../server/keys.mjs";
import {
  createSolana,
  describeBuildError,
  signFor,
  swapRequestBody,
  transferMessage,
  TRANSFER_FEE_LAMPORTS,
} from "../server/solana.mjs";

const fixture = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../src/lib/swap/fixtures/${name}`, import.meta.url), "utf8"));
const quote = fixture("quote-sol-usdc.json");
const build = fixture("build-sol-usdc.json");
const FIXTURE_WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SYSTEM = "11111111111111111111111111111111";
const CB = "ComputeBudget111111111111111111111111111111";

/** The router's real v1 bytes, with our own key in the fee payer's slot. */
function buildFor(key) {
  const raw = Buffer.from(build.swapTransaction, "base64");
  const at = raw.indexOf(Buffer.from(fromBase58(FIXTURE_WALLET)));
  assert.ok(at > 0);
  raw.set(key.secret.subarray(32), at);
  return raw.toString("base64");
}

describe("what the router is asked", () => {
  const owner = generateKey("sol").address;
  test("the server's quote, the trader's fee or the capped estimate, nothing else", () => {
    const own = swapRequestBody(owner, quote, { priorityFeeLamports: 100_000, priorityMaxLamports: 500_000 });
    assert.equal(own.prioritizationFeeLamports, 100_000);
    assert.equal(own.userPublicKey, owner);
    assert.equal(own.quoteResponse, quote);
    assert.deepEqual(Object.keys(own).sort(), ["prioritizationFeeLamports", "quoteResponse", "serialize", "userPublicKey", "wrapAndUnwrapSol"]);
    const auto = swapRequestBody(owner, quote, { priorityMaxLamports: 500_000 });
    assert.deepEqual(auto.prioritizationFeeLamports, { priorityLevelWithMaxLamports: { maxLamports: 500_000 } });
  });

  test("a malformed request is refused", () => {
    const o = (priorityFeeLamports) => ({ priorityFeeLamports, priorityMaxLamports: 1 });
    assert.throws(() => swapRequestBody(owner, quote, o(1.5)), /Priority fee/);
    assert.throws(() => swapRequestBody(owner, quote, o(100_000_001)), /Priority fee/);
    assert.throws(() => swapRequestBody("nope", quote, o()), /Not a Solana wallet/);
    assert.throws(() => swapRequestBody(owner, { ...quote, routePlan: [] }, o()), /Malformed quote/);
    assert.throws(() => swapRequestBody(owner, { ...quote, inAmount: 5 }, o()), /Malformed quote/);
  });

  test("router refusals read as something to do", () => {
    assert.match(describeBuildError(401, { error: { code: "unauthorized" } }), /RAZE_API_KEY/);
    assert.match(describeBuildError(409, { reason: "stale" }), /changed since the quote \(stale\)/);
    assert.match(describeBuildError(400, { reason: "dark_trader" }), /SolFi V2/);
    assert.match(describeBuildError(500, null), /HTTP 500/);
  });
});

describe("signing the router's v1 transaction", () => {
  const key = generateKey("sol");
  const unsigned = buildFor(key);

  test("fills the fee payer's slot with a valid signature, nothing else changes", () => {
    const { signed, signature } = signFor(unsigned, key.address, key.secret);
    const before = Buffer.from(unsigned, "base64");
    const out = Buffer.from(signed, "base64");
    assert.equal(out.length, before.length);
    const tx = getTransactionDecoder().decode(out);
    const sig = tx.signatures[key.address];
    assert.equal(toBase58(sig), signature);
    assert.ok(ed25519.verify(sig, Uint8Array.from(tx.messageBytes), fromBase58(key.address)));
    // v1: the message first, the 64-byte slot after it.
    assert.deepEqual(out.subarray(0, out.length - 64), before.subarray(0, before.length - 64));
  });

  test("refuses a transaction built for another wallet", () => {
    assert.throws(() => signFor(build.swapTransaction, key.address, key.secret), /another wallet/);
    const other = generateKey("sol");
    assert.throws(() => signFor(unsigned, other.address, other.secret), /another wallet/);
  });

  test("refuses a key that is not the wallet's", () => {
    const other = generateKey("sol");
    assert.throws(() => signFor(unsigned, key.address, other.secret), /does not match/);
  });

  test("garbage is not signed", () => {
    assert.throws(() => signFor("AAAA", key.address, key.secret), /unreadable/);
  });
});

describe("a SOL transfer", () => {
  const from = generateKey("sol");
  const to = generateKey("sol").address;
  const blockhash = "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N";

  test("compiles to budget, budget, transfer — read back by a real decoder", () => {
    const msg = transferMessage({ from: from.address, to, lamports: 1_234_567n, blockhash });
    const m = getCompiledTransactionMessageDecoder().decode(msg);
    assert.equal(m.version, "legacy");
    assert.deepEqual(m.header, { numSignerAccounts: 1, numReadonlySignerAccounts: 0, numReadonlyNonSignerAccounts: 2 });
    assert.deepEqual(m.staticAccounts, [from.address, to, SYSTEM, CB]);
    assert.equal(m.lifetimeToken, blockhash);
    assert.equal(m.instructions.length, 3);
    const [limit, price, transfer] = m.instructions;
    assert.equal(limit.programAddressIndex, 3);
    assert.deepEqual([...limit.data], [2, 0xe8, 0x03, 0, 0]);
    assert.equal(price.data[0], 3);
    assert.equal(transfer.programAddressIndex, 2);
    assert.deepEqual(transfer.accountIndices, [0, 1]);
    const data = Buffer.from(transfer.data);
    assert.equal(data.readUInt32LE(0), 2);
    assert.equal(data.readBigUInt64LE(4), 1_234_567n);
  });

  test("its fee is the base fee plus the priority fee", () => {
    assert.equal(TRANSFER_FEE_LAMPORTS, 5_200n);
  });

  test("end to end against a fake RPC: max sends everything but the fee", async () => {
    const calls = [];
    const fakeFetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      const result = {
        getBalance: { value: 1_000_000 },
        getLatestBlockhash: { value: { blockhash, lastValidBlockHeight: 1 } },
        sendTransaction: "sig",
      }[body.method];
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    };
    const sol = createSolana({ rpcUrl: "http://rpc", routerBase: "http://router", apiKey: "", priorityMaxLamports: 1 }, { fetch: fakeFetch });
    const out = await sol.transfer({ address: from.address, secret: from.secret }, to, "max");
    assert.equal(out.lamports, String(1_000_000n - TRANSFER_FEE_LAMPORTS));
    const sent = calls.find((c) => c.method === "sendTransaction");
    const tx = getTransactionDecoder().decode(Buffer.from(sent.params[0], "base64"));
    assert.ok(ed25519.verify(tx.signatures[from.address], Uint8Array.from(tx.messageBytes), fromBase58(from.address)));
    await assert.rejects(() => sol.transfer({ address: from.address, secret: from.secret }, from.address, "1"), /own address/);
    await assert.rejects(() => sol.transfer({ address: from.address, secret: from.secret }, to, "1.5"), /Enter an amount/);
  });

  test("a swap: the router gets the key, the RPC gets the signed bytes", async () => {
    const seen = {};
    const fakeFetch = async (url, init) => {
      if (String(url).startsWith("http://router")) {
        seen.router = { url, headers: init.headers, body: JSON.parse(init.body) };
        return new Response(JSON.stringify({ ...build, swapTransaction: buildFor(from) }));
      }
      seen.rpc = JSON.parse(init.body);
      return new Response(JSON.stringify({
        jsonrpc: "2.0", id: 1,
        error: { message: "Transaction simulation failed", data: { err: "AccountNotFound" } },
      }));
    };
    const sol = createSolana({ rpcUrl: "http://rpc", routerBase: "http://router", apiKey: "k_123", priorityMaxLamports: 7 }, { fetch: fakeFetch });
    await assert.rejects(
      () => sol.swap({ address: from.address, secret: from.secret }, { quote }),
      (e) => e.code === "rpc" && /simulation failed \(AccountNotFound\)/.test(e.message),
    );
    assert.equal(seen.router.url, "http://router/swap-instructions");
    assert.equal(seen.router.headers["x-api-key"], "k_123");
    assert.equal(seen.router.body.userPublicKey, from.address);
    assert.equal(seen.rpc.method, "sendTransaction");
    const tx = getTransactionDecoder().decode(Buffer.from(seen.rpc.params[0], "base64"));
    assert.ok(ed25519.verify(tx.signatures[from.address], Uint8Array.from(tx.messageBytes), fromBase58(from.address)));
  });

  test("a swap whose session ended while the router built it is not signed", async () => {
    let rpcCalls = 0;
    const fakeFetch = async (url) => {
      if (String(url).startsWith("http://router")) return new Response(JSON.stringify({ ...build, swapTransaction: buildFor(from) }));
      rpcCalls += 1;
      return new Response("{}");
    };
    const sol = createSolana({ rpcUrl: "http://rpc", routerBase: "http://router", apiKey: "", priorityMaxLamports: 7 }, { fetch: fakeFetch });
    await assert.rejects(
      () => sol.swap({ address: from.address, secret: from.secret }, { quote }, { stillUnlocked: () => false }),
      (e) => e.code === "locked",
    );
    assert.equal(rpcCalls, 0);
  });
});
