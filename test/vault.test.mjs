import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateKey, toBase58 } from "../server/keys.mjs";
import { formatRecoveryKey, parseRecoveryKey, Vault, VAULT_FILE } from "../server/vault.mjs";

// The smallest work factor the vault accepts, so the suite stays fast.
const KDF = { N: 1 << 10, r: 8, p: 1 };
const PW = "correct horse battery";

let dir;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "trade-ui-vault-"));
});
afterEach(async () => {
  await fs.chmod(dir, 0o700).catch(() => {});
  await fs.rm(dir, { recursive: true, force: true });
});

const fresh = () => new Vault({ dir, kdf: KDF });
const RECOVERY_RE = /^(?:[0-9A-HJKMNP-TV-Z]{4}-){8}[0-9A-HJKMNP-TV-Z]{4}$/;
const readFile = async () => JSON.parse(await fs.readFile(path.join(dir, VAULT_FILE), "utf8"));

describe("vault", () => {
  test("first run creates an encrypted file, readable by its owner only", async () => {
    const v = fresh();
    assert.equal(await v.initialized(), false);
    const { recoveryKey } = await v.create(PW);
    assert.match(recoveryKey, RECOVERY_RE);
    assert.equal(v.unlocked, true);
    assert.equal(v.hasRecoveryKey, true);
    const st = await fs.stat(path.join(dir, VAULT_FILE));
    assert.equal(st.mode & 0o777, 0o600);
    const file = await readFile();
    assert.deepEqual([file.format, file.version, file.kdf.name, file.cipher.name], ["trade-ui-vault", 2, "scrypt", "aes-256-gcm"]);
    assert.deepEqual(Object.keys(file.keys).sort(), ["password", "recovery"]);
    // The recovery key itself is not in the file.
    assert.ok(!JSON.stringify(file).includes(recoveryKey.replace(/-/g, "")));
    assert.equal(await fresh().canRecover(), true);
    await assert.rejects(() => fresh().create(PW), { code: "vault_exists" });
  });

  test("a short password is refused", async () => {
    await assert.rejects(() => fresh().create("short"), { code: "weak_password" });
    assert.equal(await fresh().initialized(), false);
  });

  test("nothing about the wallets is readable in the file", async () => {
    const v = fresh();
    await v.create(PW);
    const k = generateKey("sol");
    await v.import([{ secret: toBase58(k.secret), label: "Main wallet" }]);
    const text = await fs.readFile(path.join(dir, VAULT_FILE), "utf8");
    assert.ok(!text.includes(k.address));
    assert.ok(!text.includes(toBase58(k.secret)));
    assert.ok(!text.includes("Main wallet"));
  });

  test("unlock: the right password opens it, a wrong one does not", async () => {
    const v = fresh();
    await v.create(PW);
    const [w] = await v.generate("sol", { label: "a" });
    v.lock();
    assert.equal(v.unlocked, false);
    assert.throws(() => v.list(), { code: "locked" });

    const again = fresh();
    assert.equal(await again.unlock("wrong password"), false);
    assert.equal(again.unlocked, false);
    assert.equal(await again.unlock(PW), true);
    assert.deepEqual(again.list().map((x) => x.address), [w.address]);
    // NFKC: the same text from another keyboard layout derives the same key.
    assert.equal(await again.verify("correct horse battery"), true);
    assert.equal(await again.verify("Correct horse battery"), false);
  });

  test("the browser view never carries a secret", async () => {
    const v = fresh();
    await v.create(PW);
    await v.generate("sol");
    await v.import([{ address: generateKey("sol").address }]);
    for (const w of v.list()) assert.deepEqual(Object.keys(w).sort(), ["address", "createdAt", "family", "id", "label", "watchOnly"]);
    assert.deepEqual(v.list().map((w) => w.watchOnly), [false, true]);
  });

  test("import: keys, keypair files, watch addresses, duplicates and upgrades", async () => {
    const v = fresh();
    await v.create(PW);
    const a = generateKey("sol");
    const b = generateKey("evm");
    const c = generateKey("sol");
    const r = await v.import([
      { secret: toBase58(a.secret), label: "  A\n" },
      { secret: `0x${Buffer.from(b.secret).toString("hex")}` },
      { address: c.address, label: "watched" },
      { secret: toBase58(a.secret) },
      { secret: "garbage" },
    ]);
    assert.deepEqual(r.created.map((w) => w.address), [a.address, b.address, c.address]);
    assert.equal(r.created[0].label, "A");
    assert.deepEqual(r.errors.map((e) => [e.index, e.code]), [[3, "duplicate"], [4, "invalid_secret"]]);
    // A watched wallet becomes a key wallet when its key is imported.
    const up = await v.import([{ secret: JSON.stringify(Array.from(c.secret)) }]);
    assert.equal(up.created[0].address, c.address);
    assert.equal(v.list().find((w) => w.address === c.address).watchOnly, false);
    assert.equal(v.list().length, 3);
    assert.deepEqual(v.get(up.created[0].id).secret, c.secret);
  });

  test("generate, rename, remove — and every change is on disk", async () => {
    const v = fresh();
    await v.create(PW);
    const ws = await v.generate("sol", { label: "Bot", count: 3 });
    assert.deepEqual(ws.map((w) => w.label), ["Bot 1", "Bot 2", "Bot 3"]);
    await v.rename(ws[0].id, "Main");
    await v.remove(ws[1].id);
    await assert.rejects(() => v.remove(ws[1].id), { code: "not_found" });

    const again = fresh();
    assert.equal(await again.unlock(PW), true);
    assert.deepEqual(again.list().map((w) => w.label), ["Main", "Bot 3"]);
    assert.equal(again.get(ws[0].id).secret.length, 64);
  });

  test("changing the password: a new salt and key, and the recovery key keeps working", async () => {
    const v = fresh();
    const { recoveryKey } = await v.create(PW);
    const [w] = await v.generate("evm");
    const before = await readFile();
    await assert.rejects(() => v.changePassword("nope nope nope", "another password"), { code: "bad_password" });
    await assert.rejects(() => v.changePassword(PW, "short"), { code: "weak_password" });
    await v.changePassword(PW, "another password");
    const after = await readFile();
    assert.notEqual(after.kdf.salt, before.kdf.salt);
    assert.deepEqual(after.keys.recovery, before.keys.recovery);
    const again = fresh();
    assert.equal(await again.unlock(PW), false);
    assert.equal(await again.unlock("another password"), true);
    assert.deepEqual(again.get(w.id).secret, v.get(w.id).secret);
    assert.equal(await fresh().recover(recoveryKey, "a third password"), true);
  });

  test("an edited file does not open: parameters are bound to the ciphertext", async () => {
    const v = fresh();
    await v.create(PW);
    const file = path.join(dir, VAULT_FILE);
    const j = JSON.parse(await fs.readFile(file, "utf8"));
    await fs.writeFile(file, JSON.stringify({ ...j, kdf: { ...j.kdf, N: 1 << 11 } }));
    assert.equal(await fresh().unlock(PW), false);
    await fs.writeFile(file, JSON.stringify({ ...j, kdf: { ...j.kdf, N: 2 } }));
    await assert.rejects(() => fresh().unlock(PW), { code: "corrupt_vault" });
    // The password's wrap still opens; the wallets do not.
    const ct = Buffer.from(j.ciphertext, "base64");
    ct[0] ^= 1;
    await fs.writeFile(file, JSON.stringify({ ...j, ciphertext: ct.toString("base64") }));
    await assert.rejects(() => fresh().unlock(PW), { code: "corrupt_vault" });
  });

  test("a write that fails leaves nothing behind in memory", async () => {
    const v = fresh();
    await v.create(PW);
    await v.generate("sol", { label: "kept" });
    await fs.chmod(dir, 0o500); // the temp file cannot be created
    await assert.rejects(() => v.generate("sol", { label: "lost" }));
    await assert.rejects(() => v.rename(v.list()[0].id, "renamed"));
    assert.deepEqual(v.list().map((w) => w.label), ["kept"]);
    await fs.chmod(dir, 0o700);
    const again = fresh();
    assert.equal(await again.unlock(PW), true);
    assert.deepEqual(again.list().map((w) => w.label), ["kept"]);
  });

  test("settings: the auto-lock delay, from a fixed list", async () => {
    const v = fresh();
    await v.create(PW);
    assert.equal(v.settings.autoLockMinutes, 15);
    await v.updateSettings({ autoLockMinutes: 60 });
    await assert.rejects(() => v.updateSettings({ autoLockMinutes: 7 }), { code: "bad_request" });
    const again = fresh();
    await again.unlock(PW);
    assert.equal(again.settings.autoLockMinutes, 60);
  });
});

describe("the recovery key", () => {
  test("it reads as typed: any case, spaces for dashes, O for 0; a typo is caught before anything is tried", () => {
    const bytes = crypto.randomBytes(20);
    const key = formatRecoveryKey(bytes);
    assert.match(key, RECOVERY_RE);
    assert.deepEqual(parseRecoveryKey(key), bytes);
    assert.deepEqual(parseRecoveryKey(` ${key.toLowerCase().replace(/-/g, " ")} `), bytes);
    assert.deepEqual(parseRecoveryKey(key.replace(/0/g, "O")), bytes);
    const flipped = key.slice(0, 5) + (key[5] === "A" ? "B" : "A") + key.slice(6);
    assert.throws(() => parseRecoveryKey(flipped), { code: "bad_recovery_key", message: /typo/ });
    assert.throws(() => parseRecoveryKey(key.slice(0, -5)), { code: "bad_recovery_key" });
    assert.throws(() => parseRecoveryKey("abandon ".repeat(11) + "about"), { code: "bad_recovery_key" });
  });

  test("a forgotten password: the recovery key sets a new one and every wallet is still there", async () => {
    const v = fresh();
    const { recoveryKey } = await v.create(PW);
    const [w] = await v.generate("sol", { label: "Main" });
    v.lock();

    const r = fresh();
    assert.equal(await r.unlock("I forgot it"), false);
    await assert.rejects(() => r.recover(recoveryKey, "short"), { code: "weak_password" });
    assert.equal(await r.recover(formatRecoveryKey(crypto.randomBytes(20)), "a new password"), false);
    assert.equal(r.unlocked, false);
    assert.equal(await r.recover(recoveryKey, "a new password"), true);
    assert.equal(r.unlocked, true);
    assert.deepEqual(r.list().map((x) => [x.address, x.label]), [[w.address, "Main"]]);

    const again = fresh();
    assert.equal(await again.unlock(PW), false);
    assert.equal(await again.unlock("a new password"), true);
    assert.equal(again.get(w.id).secret.length, 64);
    // Like a hardware wallet's phrase, it keeps working.
    assert.equal(await fresh().recover(recoveryKey, "yet another password"), true);
  });

  test("recovering while another browser holds the vault open keeps its latest changes", async () => {
    // One server, one vault: a browser has it open while another recovers it.
    const v = fresh();
    const { recoveryKey } = await v.create(PW);
    const pending = v.generate("sol", { label: "before" });
    assert.equal(await v.recover(recoveryKey, "a new password"), true);
    await pending;
    await v.generate("sol", { label: "after" });
    const again = fresh();
    assert.equal(await again.unlock("a new password"), true);
    assert.deepEqual(again.list().map((x) => x.label), ["before", "after"]);
  });

  test("a new recovery key needs the password and retires the old one", async () => {
    const v = fresh();
    const { recoveryKey: first } = await v.create(PW);
    const [w] = await v.generate("sol");
    const before = await readFile();
    await assert.rejects(() => v.newRecoveryKey("wrong password"), { code: "bad_password" });
    const second = await v.newRecoveryKey(PW);
    assert.match(second, RECOVERY_RE);
    assert.notEqual(second, first);
    const after = await readFile();
    assert.notEqual(after.keys.recovery.salt, before.keys.recovery.salt);
    assert.equal(after.kdf.salt, before.kdf.salt);

    assert.equal(await fresh().recover(first, "a new password"), false);
    assert.equal(await fresh().unlock(PW), true);
    const r = fresh();
    assert.equal(await r.recover(second, "a new password"), true);
    assert.deepEqual(r.get(w.id).secret, v.get(w.id).secret);
    // The data key changed too: the old file's password wrap opens nothing of the new file.
    const oldKek = await new Promise((res, rej) => crypto.scrypt(PW, Buffer.from(before.kdf.salt, "base64"), 32,
      { ...KDF, maxmem: 256 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
    const aad = Buffer.from(`trade-ui-vault/2|password|scrypt|${KDF.N}|${KDF.r}|${KDF.p}|${before.kdf.salt}`);
    const d = crypto.createDecipheriv("aes-256-gcm", oldKek, Buffer.from(before.keys.password.iv, "base64"), { authTagLength: 16 });
    d.setAAD(aad);
    d.setAuthTag(Buffer.from(before.keys.password.tag, "base64"));
    const oldDek = Buffer.concat([d.update(Buffer.from(before.keys.password.wrapped, "base64")), d.final()]);
    const nd = crypto.createDecipheriv("aes-256-gcm", oldDek, Buffer.from(after.cipher.iv, "base64"), { authTagLength: 16 });
    nd.setAAD(Buffer.from("trade-ui-vault/2|data"));
    nd.setAuthTag(Buffer.from(after.cipher.tag, "base64"));
    nd.update(Buffer.from(after.ciphertext, "base64"));
    assert.throws(() => nd.final());
  });

  test("an edited recovery wrap opens nothing", async () => {
    const v = fresh();
    const { recoveryKey } = await v.create(PW);
    const j = await readFile();
    const salt = Buffer.from(j.keys.recovery.salt, "base64");
    salt[0] ^= 1;
    await fs.writeFile(path.join(dir, VAULT_FILE), JSON.stringify({ ...j, keys: { ...j.keys, recovery: { ...j.keys.recovery, salt: salt.toString("base64") } } }));
    assert.equal(await fresh().recover(recoveryKey, "a new password"), false);
  });

  test("a vault from before recovery keys opens, is rewritten, and gets one when asked", async () => {
    // Version 1 as an older Trade UI wrote it: the wallets under scrypt(password).
    const salt = crypto.randomBytes(16);
    const kdf = { name: "scrypt", ...KDF, salt: salt.toString("base64") };
    const key = await new Promise((res, rej) => crypto.scrypt(PW, salt, 32, { ...KDF, maxmem: 256 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
    const k = generateKey("sol");
    const data = { wallets: [{ id: "w_0123456789abcdef", family: "sol", address: k.address, label: "old", secret: toBase58(k.secret), createdAt: "2026-10-01T00:00:00.000Z" }], settings: { autoLockMinutes: 30 } };
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    c.setAAD(Buffer.from(`trade-ui-vault/1|scrypt|${KDF.N}|${KDF.r}|${KDF.p}|${kdf.salt}`));
    const ct = Buffer.concat([c.update(JSON.stringify(data)), c.final()]);
    await fs.writeFile(path.join(dir, VAULT_FILE), JSON.stringify({
      format: "trade-ui-vault", version: 1, kdf,
      cipher: { name: "aes-256-gcm", iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64") },
      ciphertext: ct.toString("base64"),
    }), { mode: 0o600 });

    const v = fresh();
    assert.equal(await v.canRecover(), false);
    assert.equal(await v.verify(PW), true);
    assert.equal(await v.unlock("wrong password"), false);
    assert.equal(await v.unlock(PW), true);
    assert.deepEqual(v.list().map((w) => w.label), ["old"]);
    assert.equal(v.settings.autoLockMinutes, 30);
    assert.equal(v.hasRecoveryKey, false);
    const rewritten = await readFile();
    assert.equal(rewritten.version, 2);
    assert.equal(rewritten.keys.recovery, undefined);

    const recoveryKey = await v.newRecoveryKey(PW);
    assert.equal(v.hasRecoveryKey, true);
    const r = fresh();
    assert.equal(await r.recover(recoveryKey, "a new password"), true);
    assert.deepEqual(r.get("w_0123456789abcdef").secret, k.secret);
  });
});
