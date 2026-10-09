import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Auth, clientAddress, lockoutDelayMs, sessionCookie, SESSION_COOKIE } from "../server/auth.mjs";
import { Vault } from "../server/vault.mjs";

const KDF = { N: 1 << 10, r: 8, p: 1 };
const PW = "correct horse battery";

let dir;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "trade-ui-auth-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function setup() {
  let now = 1_000_000;
  const clock = { now: () => now, advance: (ms) => { now += ms; } };
  const vault = new Vault({ dir, kdf: KDF });
  const locks = [];
  const auth = new Auth({ vault, now: clock.now, onLock: (r) => locks.push(r) });
  return { vault, auth, clock, locks };
}

const reqWith = (token) => ({ headers: { cookie: `other=1; ${SESSION_COOKIE}=${token}` } });

describe("auth", () => {
  test("the delay doubles after four free attempts, up to five minutes", () => {
    assert.deepEqual([1, 2, 3, 4].map(lockoutDelayMs), [0, 0, 0, 0]);
    assert.deepEqual([5, 6, 7, 8].map(lockoutDelayMs), [2_000, 4_000, 8_000, 16_000]);
    assert.equal(lockoutDelayMs(12), 256_000);
    assert.equal(lockoutDelayMs(13), 300_000);
    assert.equal(lockoutDelayMs(99), 300_000);
  });

  test("wrong passwords wait, a right one resets, and nothing is written to disk", async () => {
    const { vault, auth, clock } = setup();
    await vault.create(PW);
    const A = "ip:203.0.113.7";
    for (let i = 1; i <= 4; i++) {
      const r = await auth.attempt(A, () => vault.verify("wrong"));
      assert.deepEqual([r.ok, r.reason, r.retryAfterMs, r.failures], [false, "wrong", 0, i]);
    }
    const fifth = await auth.attempt(A, () => vault.verify("wrong"));
    assert.equal(fifth.retryAfterMs, 2_000);
    // Too soon: refused without checking, even the right password.
    let checked = false;
    const early = await auth.attempt(A, () => { checked = true; return vault.verify(PW); });
    assert.deepEqual([early.ok, early.reason, checked], [false, "wait", false]);

    clock.advance(2_000);
    assert.deepEqual(await auth.attempt(A, () => vault.verify(PW)), { ok: true });
    assert.equal(auth.failures(A), 0);
    assert.equal(auth.retryAfterMs(A), 0);
    // Only the vault file: the throttle lives in memory.
    assert.deepEqual(await fs.readdir(dir), ["vault.json"]);
  });

  test("one client's guesses do not lock out another, or an open session", async () => {
    const { vault, auth } = setup();
    await vault.create(PW);
    for (let i = 0; i < 6; i++) await auth.attempt("ip:203.0.113.7", () => vault.verify("wrong"));
    assert.ok(auth.retryAfterMs("ip:203.0.113.7") > 0);
    assert.equal(auth.retryAfterMs("ip:198.51.100.1"), 0);
    assert.equal(auth.retryAfterMs(Auth.sessionKey("tok")), 0);
    assert.deepEqual(await auth.attempt("ip:198.51.100.1", () => vault.verify(PW)), { ok: true });
  });

  test("past twenty failures in a row from anywhere, attempts are paced to one a second", async () => {
    const { vault, auth, clock } = setup();
    await vault.create(PW);
    for (let i = 0; i < 20; i++) {
      await auth.attempt(`ip:10.0.0.${i}`, () => vault.verify("wrong"));
      clock.advance(1_000);
    }
    await auth.attempt("ip:10.0.1.1", () => vault.verify("wrong"));
    const paced = await auth.attempt("ip:10.0.1.2", () => vault.verify(PW));
    assert.deepEqual([paced.ok, paced.reason, paced.retryAfterMs], [false, "wait", 1_000]);
    clock.advance(1_000);
    // A right password ends the pacing.
    assert.deepEqual(await auth.attempt("ip:10.0.1.2", () => vault.verify(PW)), { ok: true });
    assert.equal(auth.retryAfterMs("ip:10.0.1.3"), 0);
  });

  test("guesses in parallel are checked one at a time", async () => {
    const { vault, auth } = setup();
    await vault.create(PW);
    const A = "ip:203.0.113.7";
    const results = await Promise.all(Array.from({ length: 8 }, () => auth.attempt(A, () => vault.verify("wrong"))));
    assert.deepEqual(results.map((r) => r.reason), ["wrong", "wrong", "wrong", "wrong", "wrong", "wait", "wait", "wait"]);
  });

  test("the client is the socket's address; a forwarded one only from a proxy on loopback", () => {
    const req = (remote, xff) => ({ socket: { remoteAddress: remote }, headers: xff ? { "x-forwarded-for": xff } : {} });
    assert.equal(clientAddress(req("203.0.113.7", "1.2.3.4")), "203.0.113.7");
    assert.equal(clientAddress(req("127.0.0.1", "6.6.6.6, 198.51.100.1")), "198.51.100.1");
    assert.equal(clientAddress(req("::1", "not-an-ip")), "::1");
    assert.equal(clientAddress(req("127.0.0.1")), "127.0.0.1");
  });

  test("a session lives while the vault is unlocked; lock ends them all", async () => {
    const { vault, auth, locks } = setup();
    await vault.create(PW);
    const a = auth.createSession();
    const b = auth.createSession();
    assert.equal(auth.sessionOf(reqWith(a)), a);
    assert.equal(auth.sessionOf(reqWith("forged")), null);
    assert.equal(auth.sessionOf({ headers: {} }), null);
    auth.keepOnly(a);
    assert.equal(auth.sessionOf(reqWith(b)), null);
    auth.lock("manual");
    assert.equal(vault.unlocked, false);
    assert.equal(auth.sessionOf(reqWith(a)), null);
    assert.deepEqual(locks, ["manual"]);
    // Unlocking again does not revive old sessions.
    await vault.unlock(PW);
    assert.equal(auth.sessionOf(reqWith(a)), null);
  });

  test("idle for the vault's delay locks it; activity postpones it; 0 never", async () => {
    const { vault, auth, clock, locks } = setup();
    await vault.create(PW);
    auth.createSession();
    clock.advance(14 * 60_000);
    assert.equal(auth.checkIdle(), false);
    auth.touch();
    clock.advance(14 * 60_000);
    assert.equal(auth.checkIdle(), false);
    clock.advance(60_001);
    assert.equal(auth.checkIdle(), true);
    assert.deepEqual(locks, ["idle"]);

    await vault.unlock(PW);
    await vault.updateSettings({ autoLockMinutes: 0 });
    clock.advance(24 * 3_600_000);
    assert.equal(auth.checkIdle(), false);
  });

  test("the cookie is HttpOnly and SameSite=Strict, Secure behind HTTPS", () => {
    assert.equal(sessionCookie("t", { secure: false }), `${SESSION_COOKIE}=t; Path=/; HttpOnly; SameSite=Strict`);
    assert.match(sessionCookie("t", { secure: true }), /; Secure$/);
    assert.match(sessionCookie(null, { secure: false }), /Max-Age=0/);
  });
});
