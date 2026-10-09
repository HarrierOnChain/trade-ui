/**
 * What the wallet page sends to the vault: pasted keys split, SOL amounts in
 * lamports, and the wallets an older Trade UI kept unencrypted in the
 * browser. Run: `npm test`. Kept out of tsconfig like the other tests.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { importItems, keepLegacy, readLegacyWallets, solToLamports, splitKeys, LEGACY_WALLETS_KEY } from "./keyText.ts";

const B58_KEY = "4WwcFnBragexyZSMS8sJySdVQk72fuLb4RXw5xeYdXkYz1ieLeyHpKCqnmzzWfrW4Je21qmoZsxRuKGnqDVWd8X1";
const BYTES = Array.from({ length: 64 }, (_, i) => i);

describe("pasted keys", () => {
  test("a keypair file is one key", () => {
    assert.deepEqual(splitKeys(JSON.stringify(BYTES)), [JSON.stringify(BYTES)]);
    assert.deepEqual(splitKeys(`  ${JSON.stringify({ secretKey: BYTES })}\n`), [JSON.stringify(BYTES)]);
  });

  test("a JSON list holds keys of either form", () => {
    assert.deepEqual(splitKeys(JSON.stringify([BYTES, B58_KEY, { secretKey: BYTES }, 7])), [JSON.stringify(BYTES), B58_KEY]);
  });

  test("one per line, or separated, with comments and duplicates dropped", () => {
    const text = `# my keys\n${B58_KEY}\n0xabc, 0xdef ;0xabc\n\n`;
    assert.deepEqual(splitKeys(text), [B58_KEY, "0xabc", "0xdef"]);
  });

  test("a seed phrase stays whole, so the server can say it is not supported", () => {
    const phrase = "abandon ".repeat(11) + "about";
    assert.deepEqual(splitKeys(phrase), [phrase]);
  });

  test("labels: as given for one, numbered for several", () => {
    assert.deepEqual(importItems(["a"], " Main "), [{ secret: "a", label: "Main" }]);
    assert.deepEqual(importItems(["a", "b"], "Bot"), [{ secret: "a", label: "Bot 1" }, { secret: "b", label: "Bot 2" }]);
    assert.deepEqual(importItems(["a"], ""), [{ secret: "a" }]);
  });
});

describe("SOL amounts", () => {
  test("exact lamports, up to 9 decimals, comma or dot", () => {
    assert.equal(solToLamports("1.5"), 1_500_000_000n);
    assert.equal(solToLamports("0,000000001"), 1n);
    assert.equal(solToLamports(" 2 "), 2_000_000_000n);
    assert.equal(solToLamports("0.0000000001"), null);
    assert.equal(solToLamports("0"), null);
    assert.equal(solToLamports("1e3"), null);
    assert.equal(solToLamports("-1"), null);
  });
});

describe("wallets of an older Trade UI", () => {
  const store = (wallets: unknown[]) => ({
    getItem: (k: string) => (k === LEGACY_WALLETS_KEY ? JSON.stringify({ wallets }) : null),
  });

  test("keys become importable secrets, addresses watch-only, demo wallets stay behind", () => {
    const b64 = Buffer.from(Uint8Array.from(BYTES)).toString("base64");
    const items = readLegacyWallets(store([
      { kind: "PLATFORM", chainId: "sol", pubkey: "So1", label: "Main", secret: b64 },
      { kind: "PLATFORM", chainId: "eth", pubkey: "0x1", label: null, secret: "ab".repeat(32) },
      { kind: "PLATFORM", chainId: "sol", pubkey: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", label: "Watched", secret: null },
      { kind: "DEMO", chainId: "sol", pubkey: "demo:x", label: "Demo", secret: null },
      { kind: "PLATFORM", chainId: "sol", pubkey: "So1", secret: Buffer.from("short").toString("base64") },
    ]));
    assert.deepEqual(items, [
      { secret: JSON.stringify(BYTES), label: "Main" },
      { secret: `0x${"ab".repeat(32)}`, label: undefined },
      { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", label: "Watched" },
      // Unreadable: sent as it is, so the server names the problem and it is kept.
      { secret: Buffer.from("short").toString("base64"), label: undefined },
    ]);
  });

  test("after a move only the entries that failed stay in the browser", () => {
    const saved: Record<string, string> = {};
    const storage = {
      setItem: (k: string, v: string) => { saved[k] = v; },
      removeItem: (k: string) => { delete saved[k]; },
    };
    keepLegacy(storage, [{ pubkey: "x" }]);
    assert.deepEqual(JSON.parse(saved[LEGACY_WALLETS_KEY]), { wallets: [{ pubkey: "x" }] });
    keepLegacy(storage, []);
    assert.equal(LEGACY_WALLETS_KEY in saved, false);
  });

  test("a key the old bulk importer stored as an address is offered back as a key", () => {
    assert.deepEqual(readLegacyWallets(store([{ kind: "PLATFORM", chainId: "sol", pubkey: B58_KEY, secret: null }])), [
      { secret: B58_KEY, label: undefined },
    ]);
  });

  test("nothing stored, or garbage, is nothing to move", () => {
    assert.deepEqual(readLegacyWallets({ getItem: () => null }), []);
    assert.deepEqual(readLegacyWallets({ getItem: () => "{not json" }), []);
    assert.deepEqual(readLegacyWallets(null), []);
  });
});
