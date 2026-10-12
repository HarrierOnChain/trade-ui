import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  checksumEvm,
  decodeSecret,
  encodeSecret,
  exportFormats,
  fromBase58,
  generateKey,
  isSolanaAddress,
  parseSecret,
  solanaSign,
  toBase58,
} from "../server/keys.mjs";

describe("keys", () => {
  test("a generated Solana key is seed ‖ public key, its address the public key", () => {
    const k = generateKey("sol");
    assert.equal(k.secret.length, 64);
    assert.deepEqual(k.secret.subarray(32), ed25519.getPublicKey(k.secret.subarray(0, 32)));
    assert.equal(k.address, toBase58(k.secret.subarray(32)));
    assert.ok(isSolanaAddress(k.address));
  });

  test("a generated EVM key has a checksummed address", () => {
    const k = generateKey("evm");
    assert.equal(k.secret.length, 32);
    assert.match(k.address, /^0x[0-9a-fA-F]{40}$/);
    assert.equal(checksumEvm(k.address.toLowerCase()), k.address);
  });

  test("EIP-55 checksums match the spec's examples", () => {
    for (const a of [
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
      "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
    ]) assert.equal(checksumEvm(a.toLowerCase()), a);
  });

  test("the well-known EVM test key gives its well-known address", () => {
    // Hardhat/Anvil account #0.
    const k = parseSecret("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    assert.equal(k.family, "evm");
    assert.equal(k.address, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    assert.equal(parseSecret("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80").address, k.address);
  });

  test("a Solana key reads the same from base58 and from a keypair file", () => {
    const k = generateKey("sol");
    const fromB58 = parseSecret(toBase58(k.secret));
    const fromJson = parseSecret(JSON.stringify(Array.from(k.secret)));
    assert.equal(fromB58.address, k.address);
    assert.equal(fromJson.address, k.address);
    assert.deepEqual(fromJson.secret, k.secret);
  });

  test("refuses what is not a private key, saying why", () => {
    const k = generateKey("sol");
    assert.throws(() => parseSecret(k.address), { code: "looks_like_address" });
    assert.throws(() => parseSecret("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), { code: "looks_like_address" });
    assert.throws(() => parseSecret("abandon ".repeat(11) + "about"), { code: "unsupported_mnemonic" });
    assert.throws(() => parseSecret(""), { code: "invalid_secret" });
    assert.throws(() => parseSecret("not a key at all!"), { code: "invalid_secret" });
    assert.throws(() => parseSecret(JSON.stringify(Array.from(k.secret.subarray(0, 32)))), { code: "invalid_secret" });
    const bad = Uint8Array.from(k.secret);
    bad[40] ^= 1;
    assert.throws(() => parseSecret(toBase58(bad)), /does not match/);
    assert.throws(() => parseSecret("0x" + "0".repeat(64)), { code: "invalid_secret" });
  });

  test("an address is not a key", () => {
    assert.throws(() => parseSecret("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"), { code: "looks_like_address" });
    assert.throws(() => parseSecret(generateKey("sol").address), { code: "looks_like_address" });
    assert.ok(!isSolanaAddress("1111111111111111111111111111111111111111111111111"));
  });

  test("exports in the formats other wallets import, and the vault round-trips", () => {
    const k = generateKey("sol");
    const f = exportFormats("sol", k.secret);
    assert.equal(parseSecret(f.base58).address, k.address);
    assert.equal(parseSecret(f.json).address, k.address);
    assert.deepEqual(decodeSecret("sol", encodeSecret("sol", k.secret)), k.secret);
    const e = generateKey("evm");
    assert.equal(parseSecret(exportFormats("evm", e.secret).hex).address, e.address);
    assert.deepEqual(decodeSecret("evm", encodeSecret("evm", e.secret)), e.secret);
  });

  test("signs with the seed half", () => {
    const k = generateKey("sol");
    const msg = new TextEncoder().encode("trade-ui");
    assert.ok(ed25519.verify(solanaSign(k.secret, msg), msg, fromBase58(k.address)));
  });
});
