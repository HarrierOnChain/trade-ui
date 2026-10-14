/**
 * Access control, the way a hardware wallet does it: one password unlocks the
 * vault; while it is unlocked, each browser that typed the password holds a
 * session; locking (by hand, after the idle delay, or on restart) forgets the
 * key and ends every session at once.
 *
 *   - Sessions: a random 256-bit token in an HttpOnly, SameSite=Strict cookie;
 *     only its SHA-256 is kept, in memory.
 *   - Wrong passwords: counted per client — per address for unlock and setup,
 *     per session for the checks an unlocked browser makes (export, delete,
 *     send, password change). After 4 in a row that client waits, doubling
 *     from 2 s to 5 min. Guessing from one place cannot lock the owner out
 *     from another, or out of an open session. Across all clients, after 20
 *     failures in a row attempts are paced to one a second, which bounds a
 *     guesser that rotates addresses.
 *   - Idle: no user activity for the vault's `autoLockMinutes` locks it.
 */
import crypto from "node:crypto";
import net from "node:net";

export const SESSION_COOKIE = "trade_ui_session";
const FREE_ATTEMPTS = 4;
const MAX_DELAY_MS = 5 * 60_000;
const MAX_SESSIONS = 32;
const MAX_CLIENTS = 2000;
const GLOBAL_AFTER = 20;
const GLOBAL_GAP_MS = 1000;

/** Delay after `failures` wrong passwords in a row from one client. */
export function lockoutDelayMs(failures) {
  if (failures <= FREE_ATTEMPTS) return 0;
  return Math.min(MAX_DELAY_MS, 1000 * 2 ** (failures - FREE_ATTEMPTS));
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

export function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}

function isLoopbackAddress(a) {
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

/** Proxies besides loopback whose `X-Forwarded-For` is believed
 *  (TRADE_UI_TRUSTED_PROXIES): a reverse proxy in another container. */
let trustedProxies = null;

/**
 * Trust the `X-Forwarded-For` of connections from these addresses or CIDR
 * ranges (IPv4 or IPv6), as loopback's is. Throws on an entry that is
 * neither.
 * @param {string[]} entries
 */
export function trustProxies(entries) {
  if (!entries.length) {
    trustedProxies = null;
    return;
  }
  const list = new net.BlockList();
  for (const e of entries) {
    const [addr, bits] = e.split("/");
    const family = net.isIPv6(addr) ? "ipv6" : net.isIPv4(addr) ? "ipv4" : null;
    const max = family === "ipv6" ? 128 : 32;
    if (!family || (bits != null && !(/^[0-9]{1,3}$/.test(bits) && Number(bits) <= max))) {
      throw new Error(`TRADE_UI_TRUSTED_PROXIES: "${e}" is not an address or a CIDR range`);
    }
    if (bits == null) list.addAddress(addr, family);
    else list.addSubnet(addr, Number(bits), family);
  }
  trustedProxies = list;
}

function isTrustedProxy(a) {
  if (isLoopbackAddress(a)) return true;
  if (!trustedProxies) return false;
  // An IPv4 peer on a dual-stack socket reads as ::ffff:a.b.c.d.
  const v4 = a.startsWith("::ffff:") ? a.slice(7) : a;
  if (net.isIPv4(v4)) return trustedProxies.check(v4, "ipv4");
  return net.isIPv6(a) && trustedProxies.check(a, "ipv6");
}

/**
 * Who is asking, for the password throttle. Behind a reverse proxy every
 * connection comes from the proxy (loopback on this machine, or an address
 * in TRADE_UI_TRUSTED_PROXIES): then the proxy's last `X-Forwarded-For`
 * entry, which a client cannot forge, is the address.
 */
export function clientAddress(req) {
  const remote = String(req.socket?.remoteAddress || "");
  if (isTrustedProxy(remote)) {
    const xff = String(req.headers["x-forwarded-for"] || "");
    const last = xff.split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (last && net.isIP(last)) return last;
  }
  return remote || "unknown";
}

export class Auth {
  #vault;
  #now;
  #onLock;
  /** @type {Map<string, { createdAt: number }>} sha256(token) → session */
  #sessions = new Map();
  /** @type {Map<string, { failures: number, until: number }>} client → wrong passwords */
  #clients = new Map();
  #globalFailures = 0;
  #globalLast = 0;
  #lastActivity = 0;
  #timer = null;
  /** Password checks run one at a time: a burst of guesses cannot run in
   *  parallel ahead of the delay, and only one scrypt runs at once. */
  #checking = Promise.resolve();

  /**
   * @param {{ vault: import("./vault.mjs").Vault, now?: () => number,
   *           onLock?: (reason: string) => void }} opts
   */
  constructor({ vault, now = Date.now, onLock = () => {} }) {
    this.#vault = vault;
    this.#now = now;
    this.#onLock = onLock;
  }

  /** Milliseconds before `client` may try a password again. */
  retryAfterMs(client) {
    const now = this.#now();
    const own = this.#clients.get(client);
    const mine = own ? Math.max(0, own.until - now) : 0;
    const all = this.#globalFailures >= GLOBAL_AFTER ? Math.max(0, this.#globalLast + GLOBAL_GAP_MS - now) : 0;
    return Math.max(mine, all);
  }

  failures(client) {
    return this.#clients.get(client)?.failures ?? 0;
  }

  #fail(client) {
    const now = this.#now();
    const c = this.#clients.get(client) ?? { failures: 0, until: 0 };
    c.failures += 1;
    c.until = now + lockoutDelayMs(c.failures);
    this.#clients.delete(client);
    this.#clients.set(client, c);
    if (this.#clients.size > MAX_CLIENTS) this.#clients.delete(this.#clients.keys().next().value);
    this.#globalFailures += 1;
    this.#globalLast = now;
    return c.failures;
  }

  #succeed(client) {
    this.#clients.delete(client);
    this.#globalFailures = 0;
  }

  /**
   * Check a password with the throttle around it. `fn()` does the real check
   * (unlock or verify) and resolves true/false. `client` is
   * `ip:<address>` for unlock and setup, `session:<id>` inside a session.
   *
   * @returns {Promise<{ ok: true } | { ok: false, reason: "wait" | "wrong", retryAfterMs: number, failures: number }>}
   */
  attempt(client, fn) {
    const run = async () => {
      const wait = this.retryAfterMs(client);
      if (wait > 0) return { ok: false, reason: "wait", retryAfterMs: wait, failures: this.failures(client) };
      const ok = await fn();
      if (ok) {
        this.#succeed(client);
        return { ok: true };
      }
      const failures = this.#fail(client);
      return { ok: false, reason: "wrong", retryAfterMs: this.retryAfterMs(client), failures };
    };
    const p = this.#checking.then(run, run);
    this.#checking = p.catch(() => {});
    return p;
  }

  // ── sessions ─────────────────────────────────────────────────────────

  /** A new session for a browser that just proved the password. */
  createSession() {
    const token = crypto.randomBytes(32).toString("base64url");
    if (this.#sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.#sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) this.#sessions.delete(oldest[0]);
    }
    this.#sessions.set(sha256(token), { createdAt: this.#now() });
    this.touch();
    return token;
  }

  /** The session token of `req`, if it is a live session of an unlocked vault. */
  sessionOf(req) {
    if (!this.#vault.unlocked) return null;
    const token = readCookie(req, SESSION_COOKIE);
    if (!token || token.length > 128) return null;
    return this.#sessions.has(sha256(token)) ? token : null;
  }

  /** A stable, non-secret name for a session: the throttle key inside it. */
  static sessionKey(token) {
    return `session:${sha256(token).slice(0, 32)}`;
  }

  endSession(token) {
    if (token) this.#sessions.delete(sha256(token));
  }

  /** Keep only `token`'s session (after a password change). */
  keepOnly(token) {
    const keep = sha256(token);
    for (const k of [...this.#sessions.keys()]) if (k !== keep) this.#sessions.delete(k);
  }

  get sessionCount() {
    return this.#sessions.size;
  }

  // ── locking ──────────────────────────────────────────────────────────

  /** Forget the key and every session. */
  lock(reason = "manual") {
    const wasUnlocked = this.#vault.unlocked;
    this.#vault.lock();
    this.#sessions.clear();
    if (wasUnlocked) this.#onLock(reason);
  }

  /** User activity: postpones the idle lock. */
  touch() {
    this.#lastActivity = this.#now();
  }

  idleMs() {
    return this.#now() - this.#lastActivity;
  }

  /** Lock if the vault has been idle longer than its setting. */
  checkIdle() {
    if (!this.#vault.unlocked) return false;
    const minutes = this.#vault.settings.autoLockMinutes;
    if (!minutes) return false;
    if (this.idleMs() < minutes * 60_000) return false;
    this.lock("idle");
    return true;
  }

  startIdleTimer(everyMs = 15_000) {
    this.stopIdleTimer();
    this.#timer = setInterval(() => this.checkIdle(), everyMs);
    this.#timer.unref?.();
  }

  stopIdleTimer() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }
}

/** `Set-Cookie` for a session (or its removal with `token` null). */
export function sessionCookie(token, { secure }) {
  const parts = [
    `${SESSION_COOKIE}=${token ?? ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (token === null) parts.push("Max-Age=0");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
