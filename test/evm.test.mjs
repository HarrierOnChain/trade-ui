/**
 * The server side of an EVM swap. Fixtures: real answers of
 * router.raze.bot/evm on Base (2026-10-09), unsigned, never sent: a buy
 * (ETH → USDC, no approval) and a sell (USDC → ETH, one approval), built for
 * a funded wallet seen on chain; the tests put their own wallet in `from`.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { generateKey } from "../server/keys.mjs";
import {
  checkedTransactions,
  createEvm,
  describeRouterError,
  evmAddressOfKey,
  quoteBody,
  rlp,
  signEip1559,
} from "../server/evm.mjs";

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const QUOTE_BUY = fixture("evm-quote-buy.json");
const BUILD_BUY = fixture("evm-build-buy.json");
const QUOTE_SELL = fixture("evm-quote-sell.json");
const BUILD_SELL = fixture("evm-build-sell.json");
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SWAP_ROUTER = "0x2626664c2603336e57b271c5c0b26f421741e481";
const hex = (b) => `0x${Buffer.from(b).toString("hex")}`;

/** The fixture's build, made for `address`. */
function buildFor(build, address) {
  const b = structuredClone(build);
  for (const tx of [...b.approvals, b.swap]) tx.from = address;
  return b;
}

const sp = (o) => new URLSearchParams(o);

describe("signing", () => {
  // Hardhat's first test key: public, never funded on a mainnet.
  const secret = Uint8Array.from(Buffer.from("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", "hex"));

  test("the address of a key", () => {
    assert.equal(evmAddressOfKey(secret), "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
  });

  test("RLP at its edges", () => {
    assert.equal(hex(rlp(0n)), "0x80");
    assert.equal(hex(rlp(127n)), "0x7f");
    assert.equal(hex(rlp(128n)), "0x8180");
    assert.equal(hex(rlp(new Uint8Array(0))), "0x80");
    assert.equal(hex(rlp([])), "0xc0");
    assert.equal(hex(rlp(new Uint8Array(55).fill(1))).slice(0, 4), "0xb7");
    assert.equal(hex(rlp(new Uint8Array(56).fill(1))).slice(0, 6), "0xb838");
    assert.equal(hex(rlp([new Uint8Array(60)])).slice(0, 8), "0xf83eb8");
  });

  test("an EIP-1559 transaction, byte for byte what ethers 6 signs", () => {
    // ethers 6.17 Wallet.signTransaction of the same fields gave these bytes.
    const out = signEip1559({
      chainId: 8453n,
      nonce: 7n,
      maxPriorityFeePerGas: 1_000_000n,
      maxFeePerGas: 9_000_000n,
      gas: 160_000n,
      to: USDC,
      value: 3_000_000_000_000_000n,
      data: `0x095ea7b3000000000000000000000000${SWAP_ROUTER.slice(2)}${"f".repeat(64)}`,
    }, secret);
    assert.equal(out.raw, "0x02f8b782210507830f4240838954408302710094833589fcd6edb6e08f4c7c32d4f71b54bda02913870aa87bee538000b844095ea7b30000000000000000000000002626664c2603336e57b271c5c0b26f421741e481ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc080a0864e3f5a29b569f72c24c31c64d7ab3eeaff2b1e79bcb0a4ad5e76a3e1335482a02acfeae461024a70588e669f1eecdfadd4f8108cdfd0e07e8821c6a646faef46");
    assert.equal(out.hash, "0x081233f0e7fdc4d17c941fdb1127a8d46f91320e609748bc67e7f2aeb21463ec");
  });
});

describe("what the router is asked", () => {
  test("chain, tokens, amount, slippage and hops; nothing else", () => {
    const body = quoteBody(sp({ chain: "base", tokenIn: "native", tokenOut: USDC.toUpperCase().replace("0X", "0x"), amountIn: "1000", slippageBps: "150", maxHops: "3", venues: "x", sender: "0x1" }));
    assert.deepEqual(body, {
      chain: "base",
      tokenIn: { kind: "native" },
      tokenOut: { kind: "erc20", address: USDC },
      amountIn: "1000",
      slippageBps: 150,
      maxHops: 3,
    });
    assert.equal(quoteBody(sp({ chain: "bsc", tokenIn: USDC, tokenOut: "native", amountIn: "1" })).slippageBps, 100);
  });

  test("a bad request is refused before the router", () => {
    const ok = { chain: "base", tokenIn: "native", tokenOut: USDC, amountIn: "1" };
    assert.throws(() => quoteBody(sp({ ...ok, chain: "sol" })), /Unknown EVM chain/);
    assert.throws(() => quoteBody(sp({ ...ok, tokenOut: "native" })), /same token/);
    assert.throws(() => quoteBody(sp({ ...ok, tokenOut: "0x123" })), /native` or a 0x address/);
    assert.throws(() => quoteBody(sp({ ...ok, amountIn: "01" })), /Bad amount/);
    assert.throws(() => quoteBody(sp({ ...ok, amountIn: (1n << 256n).toString() })), /Bad amount/);
    assert.throws(() => quoteBody(sp({ ...ok, maxHops: "4" })), /maxHops/);
    assert.throws(() => quoteBody(sp({ ...ok, slippageBps: "5001" })), /above 50%/);
    assert.throws(() => quoteBody(sp({ ...ok, slippageBps: "300" }), { maxSlippageBps: 200 }), /above 2%/);
  });

  test("router refusals read as something to do", () => {
    assert.match(describeRouterError(401, {}), /RAZE_API_KEY/);
    assert.match(describeRouterError(409, { error: { code: "QUOTE_STALE" } }), /price moved/);
    assert.match(describeRouterError(404, { error: { code: "NO_ROUTE" } }), /No route/);
    assert.match(describeRouterError(502, { error: { code: "RPC_UNAVAILABLE", rpcError: "RPC_TIMEOUT" } }), /RPC_TIMEOUT/);
  });
});

describe("what gets signed", () => {
  const me = generateKey("evm").address;
  const at = (quote, build) => checkedTransactions(buildFor(build, me), { quote, owner: me, chainId: 8453 });

  test("the router's real buy and sell pass, in order, with their gas", () => {
    const buy = at(QUOTE_BUY, BUILD_BUY);
    assert.deepEqual(buy.map((t) => [t.to, t.value, t.gas]), [[SWAP_ROUTER, 1_000_000_000_000_000n, 149_476n]]);
    const sell = at(QUOTE_SELL, BUILD_SELL);
    assert.deepEqual(sell.map((t) => [t.to, t.value]), [[USDC, 0n], [SWAP_ROUTER, 0n]]);
    assert.ok(sell[0].data.startsWith("0x095ea7b3"));
  });

  test("anything else is refused before a key is touched", () => {
    const refused = (quote, build, re) => assert.throws(() => at(quote, build), re);
    const edit = (build, fn) => {
      const b = structuredClone(build);
      fn(b);
      return b;
    };
    // another wallet in `from` (buildFor would overwrite it: check directly)
    assert.throws(() => checkedTransactions(BUILD_BUY, { quote: QUOTE_BUY, owner: me, chainId: 8453 }), /from another wallet/);
    refused(QUOTE_BUY, edit(BUILD_BUY, (b) => { b.chainId = 1; }), /another quote or chain/);
    refused(QUOTE_BUY, edit(BUILD_BUY, (b) => { b.quoteId = "x"; }), /another quote or chain/);
    refused(QUOTE_BUY, edit(BUILD_BUY, (b) => { b.swap.to = USDC; }), /swap to another contract/);
    refused(QUOTE_BUY, edit(BUILD_BUY, (b) => { b.swap.value = "2000000000000000"; }), /another value/);
    refused(QUOTE_BUY, edit(BUILD_BUY, (b) => { b.swap.chainId = 1; }), /on another chain/);
    refused(QUOTE_BUY, edit(BUILD_BUY, (b) => { delete b.swap.gas; }), /swap gas/);
    refused(QUOTE_BUY, edit(BUILD_BUY, (b) => { b.swap.gas = "9000000"; }), /swap gas/);
    refused(QUOTE_BUY, edit(BUILD_BUY, (b) => { b.approvals = [structuredClone(BUILD_SELL.approvals[0])]; }), /native input/);
    refused(QUOTE_SELL, edit(BUILD_SELL, (b) => { b.spender = USDC; }), /another spender/);
    const other = "1111111111111111111111111111111111111111";
    refused(QUOTE_SELL, edit(BUILD_SELL, (b) => { b.approvals[0].data = b.approvals[0].data.replace(SWAP_ROUTER.slice(2), other); }), /another spender/);
    refused(QUOTE_SELL, edit(BUILD_SELL, (b) => { b.approvals[0].data = b.approvals[0].data.slice(0, 74) + "f".repeat(64); }), /above the amount/);
    refused(QUOTE_SELL, edit(BUILD_SELL, (b) => { b.approvals[0].data = `0xa9059cbb${b.approvals[0].data.slice(10)}`; }), /not an approve call/);
    refused(QUOTE_SELL, edit(BUILD_SELL, (b) => { b.approvals[0].to = SWAP_ROUTER; }), /another token/);
    refused(QUOTE_SELL, edit(BUILD_SELL, (b) => { b.approvals[0].value = "1"; }), /approval with value/);
  });

  test("a simulation that did not pass says why and signs nothing", () => {
    const failed = (simulation) => {
      const b = buildFor(BUILD_BUY, me);
      b.simulation = simulation;
      return assert.throws(() => checkedTransactions(b, { quote: QUOTE_BUY, owner: me, chainId: 8453 }), (e) => {
        assert.equal(e.status, 422);
        return true;
      });
    };
    failed({ status: "failed", reason: "INSUFFICIENT_BALANCE", transaction: 0 });
    failed({ status: "failed", reason: "OUTPUT_BELOW_MINIMUM", transaction: 1 });
    failed({ status: "requires_approval" });
    failed({ status: "not_simulated", reason: "RPC_TIMEOUT" });
    const b = buildFor(BUILD_BUY, me);
    b.simulation = { status: "failed", reason: "SWAP_REVERTED", revertReason: "Too little received" };
    assert.throws(() => checkedTransactions(b, { quote: QUOTE_BUY, owner: me, chainId: 8453 }), /would fail \(Too little received\)/);
  });
});

// ── the network, faked ─────────────────────────────────────────────────

const CONFIG = {
  routerEvmBase: "http://router/evm",
  apiKey: "k_1",
  maxSlippageBps: 5000,
  evmRpc: { base: { http: "http://rpc/base", ws: "ws://rpc/base" }, eth: { http: "http://rpc/eth", ws: "ws://rpc/eth" } },
};

/** A router and an RPC: `routes` answers by URL suffix, `rpc` by method. */
function fakeNet({ routes = {}, rpc = {} } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, body });
    if (url.startsWith("http://rpc/")) {
      const fn = rpc[body.method];
      if (!fn) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: `no ${body.method}` } }));
      const out = await fn(body.params, url);
      return new Response(JSON.stringify(out && out.error ? { jsonrpc: "2.0", id: 1, error: out.error } : { jsonrpc: "2.0", id: 1, result: out }));
    }
    const path = url.replace("http://router/evm", "");
    const [status, answer] = routes[path] ? await routes[path](body) : [404, { error: { code: "NOT_FOUND" } }];
    return new Response(JSON.stringify(answer), { status });
  };
  return { fetch, calls };
}

describe("quotes, kept here", () => {
  test("the router's answer goes back with a token; the key goes to the router only", async () => {
    const net = fakeNet({ routes: { "/quote": async () => [200, QUOTE_BUY] } });
    const evm = createEvm(CONFIG, { fetch: net.fetch, WebSocket: null });
    const out = await evm.quote(sp({ chain: "base", tokenIn: "native", tokenOut: USDC, amountIn: "1000000000000000" }));
    assert.equal(out.status, 200);
    assert.equal(out.body.amountOut, QUOTE_BUY.amountOut);
    assert.deepEqual(evm.book.get(out.body.quoteToken), { evm: true, chain: "base", quote: QUOTE_BUY });
    assert.equal(net.calls[0].url, "http://router/evm/quote");
    assert.equal(net.calls[0].init.headers["x-api-key"], "k_1");
    assert.equal(net.calls[0].init.redirect, "error");
    assert.deepEqual(net.calls[0].body.tokenOut, { kind: "erc20", address: USDC });
  });

  test("refusals keep nothing", async () => {
    const ask = async (status, answer) => {
      const evm = createEvm(CONFIG, { fetch: fakeNet({ routes: { "/quote": async () => [status, answer] } }).fetch, WebSocket: null });
      return evm.quote(sp({ chain: "base", tokenIn: "native", tokenOut: USDC, amountIn: "1" }));
    };
    let out = await ask(401, { error: { code: "unauthorized" } });
    assert.equal(out.status, 502);
    assert.match(out.body.error.message, /RAZE_API_KEY/);
    out = await ask(404, { error: { code: "NO_ROUTE", candidates: 0 } });
    assert.deepEqual([out.status, out.body.error.code], [404, "NO_ROUTE"]);
    out = await ask(200, { chainId: 1, quoteId: "q", amountOut: "1" });
    assert.equal(out.status, 502);
    assert.equal(out.body.quoteToken, undefined);
  });
});

describe("a swap: build, check, sign, send", () => {
  function setup({ pendingNonce = 5, sendFails = () => false, buildAnswer } = {}) {
    const key = generateKey("evm");
    const wallet = { id: "w_1", family: "evm", address: key.address, secret: key.secret };
    const sent = [];
    const net = fakeNet({
      routes: {
        "/build": async (body) => buildAnswer ? buildAnswer(body) : [200, buildFor(body.quoteId === QUOTE_SELL.quoteId ? BUILD_SELL : BUILD_BUY, wallet.address)],
      },
      rpc: {
        eth_getTransactionCount: async () => `0x${pendingNonce.toString(16)}`,
        eth_sendRawTransaction: async ([raw]) => {
          if (sendFails(sent.length)) return { error: { message: "insufficient funds for gas * price + value" } };
          sent.push(raw);
          return "0x" + "ab".repeat(32);
        },
      },
    });
    const evm = createEvm(CONFIG, { fetch: net.fetch, WebSocket: null });
    return { evm, wallet, sent, net };
  }
  const kept = (quote) => ({ evm: true, chain: "base", quote });
  const fee = { maxFeePerGas: 11_000_000n, maxPriorityFeePerGas: 1_000_000n };

  test("approval then swap, consecutive nonces from the pending count, the router's fees and gas", async () => {
    const { evm, wallet, sent, net } = setup();
    const out = await evm.swap(wallet, kept(QUOTE_SELL));
    const build = net.calls.find((c) => c.url.endsWith("/build")).body;
    assert.deepEqual(build, { chain: "base", quoteId: QUOTE_SELL.quoteId, sender: wallet.address, recipient: wallet.address });
    const [approval, swap] = checkedTransactions(buildFor(BUILD_SELL, wallet.address), { quote: QUOTE_SELL, owner: wallet.address, chainId: 8453 });
    const expect = [
      signEip1559({ chainId: 8453n, nonce: 5n, ...fee, ...approval }, wallet.secret),
      signEip1559({ chainId: 8453n, nonce: 6n, ...fee, ...swap }, wallet.secret),
    ];
    assert.deepEqual(sent, expect.map((s) => s.raw));
    assert.equal(out.hash, expect[1].hash);
    assert.deepEqual(out.approvals, [expect[0].hash]);
  });

  test("two trades of one wallet: the second follows the first's nonces even if the RPC lags", async () => {
    const { evm, wallet, sent } = setup({ pendingNonce: 9 });
    await Promise.all([evm.swap(wallet, kept(QUOTE_BUY)), evm.swap(wallet, kept(QUOTE_BUY))]);
    const nonces = sent.map((raw) => raw.slice(0, 20));
    assert.equal(sent.length, 2);
    // The nonce is the second RLP field after the chain id (0x822105): 0x09, then 0x0a.
    assert.ok(nonces[0].includes("82210509"), nonces[0]);
    assert.ok(nonces[1].includes("8221050a"), nonces[1]);
  });

  test("a refused approval sends no swap; a lock while building signs nothing", async () => {
    let s = setup({ sendFails: (n) => n === 0 });
    await assert.rejects(s.evm.swap(s.wallet, kept(QUOTE_SELL)), /Could not send the approval: insufficient funds/);
    assert.equal(s.sent.length, 0);
    s = setup();
    await assert.rejects(s.evm.swap(s.wallet, kept(QUOTE_SELL), { stillUnlocked: () => false }), /Locked/);
    assert.equal(s.sent.length, 0);
  });

  test("a key that is not the wallet's, an expired build, a Solana quote: refused", async () => {
    const s = setup();
    const other = generateKey("evm");
    await assert.rejects(s.evm.swap({ ...s.wallet, secret: other.secret }, kept(QUOTE_BUY)), /does not match this wallet/);
    await assert.rejects(s.evm.swap(s.wallet, { quote: QUOTE_BUY }), /quote expired/);
    const gone = setup({ buildAnswer: async () => [410, { error: { code: "QUOTE_EXPIRED" } }] });
    await assert.rejects(gone.evm.swap(gone.wallet, kept(QUOTE_BUY)), (e) => e.status === 409 && /expired/.test(e.message));
    assert.equal(s.sent.length + gone.sent.length, 0);
  });
});

describe("confirmation and balances", () => {
  const HASH = `0x${"cd".repeat(32)}`;

  /** A WebSocket that subscribes, then announces `heads` blocks. */
  function fakeSocket(heads) {
    return class {
      constructor(url) {
        this.url = url;
        setTimeout(() => this.onopen?.(), 0);
      }
      send(text) {
        const m = JSON.parse(text);
        assert.deepEqual(m.params, ["newHeads"]);
        setTimeout(() => {
          this.onmessage?.({ data: JSON.stringify({ id: 1, result: "0xsub" }) });
          for (let i = 0; i < heads; i++) {
            setTimeout(() => this.onmessage?.({ data: JSON.stringify({ method: "eth_subscription", params: { result: {} } }) }), 5 * (i + 1));
          }
        }, 0);
      }
      close() {}
    };
  }

  test("the receipt is read on each new block, and the swap is confirmed", async () => {
    let reads = 0;
    const net = fakeNet({ rpc: { eth_getTransactionReceipt: async () => (++reads < 3 ? null : { status: "0x1", blockNumber: "0x10", gasUsed: "0x5208" }) } });
    const evm = createEvm(CONFIG, { fetch: net.fetch, WebSocket: fakeSocket(4) });
    assert.deepEqual(await evm.confirm("base", HASH), { status: "confirmed", block: 16, gasUsed: "21000" });
    assert.equal(reads, 3);
  });

  test("a reverted swap is an error; without a socket the receipt is read every pollMs", async () => {
    let reads = 0;
    const net = fakeNet({ rpc: { eth_getTransactionReceipt: async () => (++reads < 2 ? null : { status: "0x0", blockNumber: "0x10" }) } });
    const evm = createEvm(CONFIG, { fetch: net.fetch, WebSocket: null, pollMs: 5 });
    await assert.rejects(evm.confirm("base", HASH), /failed on-chain/);
    await assert.rejects(evm.confirm("base", "0x12"), /Bad transaction hash/);
    const stop = new AbortController();
    const waiting = createEvm(CONFIG, { fetch: fakeNet({ rpc: { eth_getTransactionReceipt: async () => null } }).fetch, WebSocket: null, pollMs: 5 })
      .confirm("base", HASH, { signal: stop.signal });
    stop.abort();
    await assert.rejects(waiting, /No longer waiting/);
  });

  test("an RPC that refuses receipt reads is named, not waited on", async () => {
    const net = fakeNet({ rpc: { eth_getTransactionReceipt: async () => ({ error: { message: "Archive requests require a personal token" } }) } });
    const evm = createEvm(CONFIG, { fetch: net.fetch, WebSocket: fakeSocket(5) });
    await assert.rejects(evm.confirm("base", HASH), /cannot read its receipt \(Archive requests require a personal token\).*EVM_RPC_URL_BASE/);
    assert.equal(net.calls.length, 3);
  });

  test("balances: native, and an ERC-20 with its decimals", async () => {
    const owner = generateKey("evm").address;
    const net = fakeNet({
      rpc: {
        eth_getBalance: async () => "0xde0b6b3a7640000",
        eth_call: async ([call]) => (call.data === "0x313ce567" ? `0x${"0".repeat(62)}06` : `0x${"0".repeat(56)}004c4b40`),
      },
    });
    const evm = createEvm(CONFIG, { fetch: net.fetch, WebSocket: null });
    assert.deepEqual(await evm.balance("base", owner, "native"), { raw: "1000000000000000000", decimals: 18 });
    assert.deepEqual(await evm.balance("base", owner, USDC), { raw: "5000000", decimals: 6 });
    const call = net.calls.find((c) => c.body.method === "eth_call" && c.body.params[0].data.startsWith("0x70a08231")).body.params[0];
    assert.equal(call.data, `0x70a08231${owner.toLowerCase().slice(2).padStart(64, "0")}`);
    assert.deepEqual(await evm.balance("base", "", USDC), { raw: null, decimals: 6 });
    await assert.rejects(evm.balance("sol", owner, "native"), /Unknown EVM chain/);
    await assert.rejects(evm.balance("base", "0x12", USDC), /Bad owner/);
  });
});
