/**
 * The server side of a launch: the form narrowed to the router's body, the
 * vault signing only its own empty slots, the EVM checks, and a whole job
 * against a fake router and RPC (the router's previous Solana build: base58,
 * no `legs`).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { getTransactionDecoder } from "@solana/kit";
import { generateKey, solanaSign, toBase58 } from "../server/keys.mjs";
import {
  checkedEvmLaunch,
  createLaunch,
  launchBody,
  publicRpc,
  signLaunchTx,
  toB64,
} from "../server/launch.mjs";

const TOKEN = { name: "Test", symbol: "$TST", description: "a test", image: "https://example.com/i.png" };
const pub = (k) => k.secret.subarray(32);

/**
 * A legacy transaction whose signers are `signers` (fee payer first), with
 * the slots of `presigned` already signed.
 */
function legacyTx(signers, presigned = []) {
  const program = new Uint8Array(32).fill(7);
  const message = Uint8Array.from([
    signers.length, 0, 1,
    signers.length + 1, ...signers.flatMap((k) => [...pub(k)]), ...program,
    ...new Uint8Array(32).fill(1),
    1, signers.length, 0, 0, 1, 9,
  ]);
  const sigs = signers.flatMap((k) => [...(presigned.includes(k) ? solanaSign(k.secret, message) : new Uint8Array(64))]);
  return { b64: Buffer.from(Uint8Array.from([signers.length, ...sigs, ...message])).toString("base64"), message };
}

function sigOf(b64, address) {
  return getTransactionDecoder().decode(Buffer.from(b64, "base64")).signatures[address];
}

describe("launchBody", () => {
  const addrs = ["A".repeat(44), "B".repeat(44)];

  test("Pump.fun: the token, amounts and options the UI offers, nothing else", () => {
    const b = launchBody({
      chain: "sol", platform: "pump", amounts: [0.5, "0.2"], token: TOKEN, slippageBps: 1000,
      mayhem: true, feeWallet: "x", feeBps: 100, jitoTipSol: 1, offchainCreator: "y",
    }, addrs);
    assert.deepEqual(b, {
      platform: "pump", wallets: addrs, amounts: [0.5, 0.2], encoding: "base64", slippageBps: 1000,
      quoteMint: "SOL", mayhem: true,
      token: { name: "Test", symbol: "TST", description: "a test", image: "https://example.com/i.png" },
    });
  });

  test("refuses what the router would refuse, before calling it", () => {
    assert.throws(() => launchBody({ chain: "sol", amounts: [1], token: { ...TOKEN, image: "" } }, addrs.slice(0, 1)), /image/);
    assert.throws(() => launchBody({ chain: "sol", amounts: [1], token: { ...TOKEN, image: "file:///etc/passwd" } }, addrs.slice(0, 1)), /http/);
    assert.throws(() => launchBody({ chain: "sol", platform: "bonk", amounts: [1], token: TOKEN }, addrs.slice(0, 1)), /Unknown launchpad/);
    assert.throws(() => launchBody({ chain: "sol", amounts: [1], token: TOKEN }, addrs), /One amount per wallet/);
    assert.throws(() => launchBody({ chain: "sol", amounts: [1], token: TOKEN, mintKey: toBase58(new Uint8Array(32).fill(3)) }, addrs.slice(0, 1)), /64-byte/);
    assert.throws(() => launchBody({ chain: "sol", platform: "meteora", amounts: [1, 0], token: TOKEN }, addrs), /must buy/);
    assert.throws(() => launchBody({ chain: "sol", amounts: [-1], token: TOKEN }, addrs.slice(0, 1)), /not an amount/);
  });

  test("pons: the deployer's dev buy and the pair", () => {
    const b = launchBody({ chain: "robinhood", amounts: [0.01, 0], token: TOKEN, creatorTaxBps: 100, slippageBps: 9999 }, ["0xa", "0xb"]);
    assert.equal(b.platform, "pons");
    assert.equal(b.devBuyEth, 0.01);
    assert.equal(b.pairToken, "eth");
    assert.equal(b.slippageBps, 9000);
    assert.equal(b.creatorTaxBps, 100);
  });
});

describe("signLaunchTx", () => {
  const creator = generateKey("sol");
  const buyer = generateKey("sol");
  const mint = generateKey("sol");
  const outsider = generateKey("sol");
  const keys = new Map([creator, buyer].map((k) => [k.address, k.secret]));

  test("fills the launch's empty slots and keeps the mint's", () => {
    const { b64, message } = legacyTx([creator, mint], [mint]);
    const s = signLaunchTx(b64, keys);
    assert.equal(s.payer, creator.address);
    assert.equal(s.version, "legacy");
    assert.ok(ed25519.verify(sigOf(s.signed, creator.address), message, pub(creator)));
    assert.ok(ed25519.verify(sigOf(s.signed, mint.address), message, pub(mint)));
    assert.equal(s.signature, toBase58(sigOf(s.signed, creator.address)));
  });

  test("refuses a transaction paid by, or needing, a wallet outside the launch", () => {
    assert.throws(() => signLaunchTx(legacyTx([outsider]).b64, keys), /outside this launch/);
    assert.throws(() => signLaunchTx(legacyTx([creator, outsider]).b64, keys), /not in this launch/);
    assert.throws(() => signLaunchTx("AAAA", keys), /unreadable/);
  });

  test("reads base58 as the router's previous build sends it", () => {
    const { b64 } = legacyTx([creator, mint], [mint]);
    const b58 = toBase58(Buffer.from(b64, "base64"));
    assert.equal(toB64(b58), b64);
    assert.equal(toB64(b64), b64);
  });
});

describe("checkedEvmLaunch", () => {
  const deployer = "0x5f330f0d2ec6349a1634248ef0379ef346dde24f";
  const router = "0xe33e9e479df8802cb0866d5d05258bec4cf62948";
  const data = (over = {}) => ({
    router, factory: "0x1111111111111111111111111111111111111111", launchFee: "0x1c6bf52634000",
    unsignedTxs: [{
      stage: "launchAndBuy", chainId: 4663, type: 2, from: deployer, to: router, data: "0xabcdef",
      value: "0x2386f26fc10000", gas: "0x44aa20", maxFeePerGas: "0x3b9aca00", maxPriorityFeePerGas: "0x1", ...over,
    }],
  });

  test("passes the deployer's launch with the dev buy and the fee", () => {
    const [tx] = checkedEvmLaunch(data(), { deployer, devBuy: 0.01 });
    assert.equal(tx.to, router);
    assert.equal(tx.value, 10n ** 16n);
  });

  test("refuses another sender, contract, chain or a larger value", () => {
    assert.throws(() => checkedEvmLaunch(data({ from: router }), { deployer, devBuy: 0.01 }), /another wallet/);
    assert.throws(() => checkedEvmLaunch(data({ to: deployer }), { deployer, devBuy: 0.01 }), /unexpected contract/);
    assert.throws(() => checkedEvmLaunch(data({ chainId: 1 }), { deployer, devBuy: 0.01 }), /another chain/);
    assert.throws(() => checkedEvmLaunch(data({ value: "0xde0b6b3a7640000" }), { deployer, devBuy: 0.01 }), /value/);
  });
});

test("publicRpc: the router cannot reach a private RPC", () => {
  assert.equal(publicRpc("https://api.mainnet-beta.solana.com"), true);
  for (const u of ["http://127.0.0.1:8899", "http://localhost:8899", "http://192.168.1.4", "http://10.0.0.2", "http://[::1]:8899", "http://node.lan"]) {
    assert.equal(publicRpc(u), false, u);
  }
});

describe("a launch job", () => {
  async function run({ mode = "safe", statuses = () => ({ confirmationStatus: "confirmed", err: null }) } = {}) {
    const creator = generateKey("sol");
    const buyer = generateKey("sol");
    const mint = generateKey("sol");
    const create = legacyTx([creator, mint], [mint]).b64;
    const buy = legacyTx([buyer]).b64;
    const calls = [];
    const fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      // The previous build: base58, no `legs`.
      const data = { platform: "pump", family: "solana", mint: mint.address, transactions: [create, buy].map((t) => toBase58(Buffer.from(t, "base64"))) };
      return new Response(JSON.stringify({ ok: true, data, error: null, nextCursor: null }));
    };
    const sent = [];
    const solana = {
      async rpc(method, params) {
        if (method === "sendTransaction") {
          sent.push(params);
          const tx = getTransactionDecoder().decode(Buffer.from(params[0], "base64"));
          return toBase58(Object.values(tx.signatures)[0]);
        }
        if (method === "getSignatureStatuses") return { value: params[0].map(statuses) };
        throw new Error(method);
      },
    };
    const launch = createLaunch(
      { routerBase: "https://router.test", apiKey: "k", launchRpcUrl: "https://rpc.test", evmRpc: {} },
      { solana, evm: {}, fetch, pollMs: 1 },
    );
    const wallets = [creator, buyer].map((k, i) => ({ id: `w_${i}`, family: "sol", address: k.address, secret: Uint8Array.from(k.secret) }));
    const { id } = launch.start({ chain: "sol", platform: "pump", amounts: [0.1, 0.2], token: TOKEN, sendMode: mode }, wallets);
    let job;
    for (let i = 0; i < 200 && !(job = launch.job(id)).done; i++) await new Promise((r) => setTimeout(r, 5));
    return { job, calls, sent, wallets, mint };
  }

  test("builds with the vault's addresses and the RPC, signs, sends the create first, confirms", async () => {
    const { job, calls, sent, wallets, mint } = await run();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://router.test/launch/sol");
    assert.deepEqual(calls[0].body.wallets, wallets.map((w) => w.address));
    assert.equal(calls[0].body.rpcUrl, "https://rpc.test");
    assert.equal(job.stage, "done", job.error);
    assert.equal(job.mint, mint.address);
    assert.deepEqual(job.legs.map((l) => [l.kind, l.walletId, l.status]), [["create", "w_0", "confirmed"], ["buy", "w_1", "confirmed"]]);
    assert.equal(sent.length, 2);
    assert.equal(sent[1][1].skipPreflight, false);
    // The job's copies of the keys are gone.
    for (const w of wallets) assert.ok(w.secret.every((b) => b === 0));
  });

  test("fast mode sends the buys without preflight", async () => {
    const { job, sent } = await run({ mode: "fast" });
    assert.equal(job.stage, "done", job.error);
    assert.equal(sent[1][1].skipPreflight, true);
  });

  test("safe mode holds the buys when the create fails", async () => {
    const { job, sent } = await run({ statuses: () => ({ err: { InstructionError: [0, "Custom"] } }) });
    assert.equal(job.stage, "failed");
    assert.equal(sent.length, 1);
    assert.equal(job.legs[1].status, "skipped");
  });
});
