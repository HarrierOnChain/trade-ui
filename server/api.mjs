/**
 * The routes this server answers itself, before Next.js:
 *
 *   GET  /api/auth/status            open: is there a vault, is this browser unlocked
 *   POST /api/auth/setup             open, needs the setup token: first password → recovery key
 *   POST /api/auth/unlock            open: password → session
 *   POST /api/auth/recover           open: recovery key + new password → session
 *   POST /api/auth/lock              session: lock now (every browser)
 *   POST /api/auth/activity          session: the user is here (postpones auto-lock)
 *   POST /api/auth/password          session: change the password
 *   POST /api/auth/recovery-key      session + password: a new recovery key
 *   POST /api/auth/settings          session: auto-lock delay
 *   GET  /api/config                 session: what this server talks to (no secrets)
 *   GET  /api/wallets                session: the wallets, without secrets
 *   POST /api/wallets/generate       session
 *   POST /api/wallets/import         session: keys and watch addresses
 *   PATCH /api/wallets/:id           session: label
 *   POST /api/wallets/:id/delete     session + password
 *   POST /api/wallets/:id/export     session + password
 *   POST /api/wallets/:id/swap       session: build a kept quote, sign, send
 *                                    (Solana or EVM, by the wallet's family)
 *   POST /api/wallets/:id/send       session + password: SOL transfer
 *   GET  /api/swap/quote             session: the Solana router's quote, kept here
 *   GET  /api/evm/quote              session: the EVM router's quote, kept here
 *   GET  /api/evm/balance            session: an EVM wallet's balance of a token
 *   POST /api/evm/confirm            session: wait for an EVM transaction's receipt
 *
 * Every other `/api/*` path needs a session too and goes on to Next.js.
 */
import crypto from "node:crypto";
import { KeyError, exportFormats } from "./keys.mjs";
import { AUTO_LOCK_CHOICES, VaultError, checkNewPassword, parseRecoveryKey } from "./vault.mjs";
import { SolanaError } from "./solana.mjs";
import { EvmError } from "./evm.mjs";
import { QuoteError } from "./quotes.mjs";
import { Auth, clientAddress, sessionCookie } from "./auth.mjs";

const JSON_LIMIT = 256 * 1024;
const LEGACY_COOKIES = ["trade_ui_api_key", "trade_ui_api_base"];

export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function sendJson(res, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  res.end(text);
}

export function sendError(res, status, code, message, extra = {}) {
  sendJson(res, status, { error: { code, message, ...extra } });
}

async function readJson(req) {
  const type = String(req.headers["content-type"] || "");
  if (!type.includes("application/json")) throw new HttpError(415, "bad_request", "Send JSON");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw new HttpError(413, "bad_request", "Body too large");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    throw new HttpError(400, "bad_request", "Body is not JSON");
  }
}

function isSecure(req, config) {
  if (config.publicUrl && config.publicUrl.startsWith("https:")) return true;
  return String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

/** Only the host of a URL: an RPC URL often carries its key in the path or query. */
function hostOnly(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

const WALLET_ROUTE = /^\/api\/wallets\/(w_[0-9a-f]{16})(?:\/(delete|export|swap|send))?$/;

/**
 * @param {{
 *   vault: import("./vault.mjs").Vault,
 *   auth: import("./auth.mjs").Auth,
 *   solana: ReturnType<typeof import("./solana.mjs").createSolana>,
 *   quotes: ReturnType<typeof import("./quotes.mjs").createQuotes>,
 *   evm: ReturnType<typeof import("./evm.mjs").createEvm>,
 *   config: any,
 *   setupToken: () => string,
 *   version: string,
 * }} deps
 */
export function createApi({ vault, auth, solana, quotes, evm, config, setupToken, version }) {
  const ipKey = (req) => `ip:${clientAddress(req)}`;
  const cookieOpts = (req) => ({ secure: isSecure(req, config) });

  function requireSession(req) {
    const token = auth.sessionOf(req);
    if (!token) throw new HttpError(401, "locked", "Locked: enter your password");
    return token;
  }

  /** A password check inside a session, throttled per session; throws on a
   *  wrong password. */
  async function requirePassword(token, password) {
    if (typeof password !== "string" || !password) {
      throw new HttpError(400, "password_required", "Enter your password");
    }
    const r = await auth.attempt(Auth.sessionKey(token), () => vault.verify(password));
    if (!r.ok) throw wrongPassword(r);
  }

  /** A refused password check: wrong (403), or tried again too soon (429). */
  function wrongPassword(r) {
    const extra = { retryAfterMs: r.retryAfterMs, failures: r.failures };
    if (r.reason === "wait") {
      const s = Math.ceil(r.retryAfterMs / 1000);
      return new HttpError(429, "too_many_attempts", `Too many wrong attempts: try again in ${s} s`, extra);
    }
    return new HttpError(403, "bad_password", "Wrong password", extra);
  }

  async function status(req, res) {
    const initialized = await vault.initialized();
    const unlocked = Boolean(auth.sessionOf(req));
    const headers = {};
    const stale = LEGACY_COOKIES.filter((c) => String(req.headers.cookie || "").includes(`${c}=`));
    if (stale.length) {
      headers["set-cookie"] = stale.map((c) => `${c}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    }
    sendJson(res, 200, {
      initialized,
      unlocked,
      // Whether "forgot your password" can work: the vault has a recovery key.
      recovery: initialized ? await vault.canRecover() : false,
      apiKeyConfigured: Boolean(config.apiKey),
      retryAfterMs: auth.retryAfterMs(ipKey(req)),
      autoLockMinutes: unlocked ? vault.settings.autoLockMinutes : null,
      desktop: config.desktop,
      version,
    }, headers);
  }

  async function setup(req, res) {
    const body = await readJson(req);
    if (await vault.initialized()) throw new HttpError(409, "vault_exists", "A password is already set: unlock instead");
    const expected = Buffer.from(setupToken());
    const given = Buffer.from(String(body.setupToken || ""));
    const r = await auth.attempt(ipKey(req), async () => given.length === expected.length && crypto.timingSafeEqual(given, expected));
    if (!r.ok) {
      if (r.reason === "wait") throw wrongPassword(r);
      throw new HttpError(403, "bad_setup_token", "Wrong setup code: copy it from the terminal where Trade UI runs");
    }
    const { recoveryKey } = await vault.create(body.password);
    const token = auth.createSession();
    // Shown once by the browser; the server keeps no copy.
    sendJson(res, 200, { ok: true, recoveryKey }, { "set-cookie": sessionCookie(token, cookieOpts(req)) });
  }

  async function unlock(req, res) {
    const body = await readJson(req);
    if (!(await vault.initialized())) throw new HttpError(409, "no_vault", "No password set yet");
    const password = body.password;
    if (typeof password !== "string" || !password) throw new HttpError(400, "password_required", "Enter your password");
    // Already unlocked by another browser: check the password, do not reload.
    const r = await auth.attempt(ipKey(req), () => (vault.unlocked ? vault.verify(password) : vault.unlock(password)));
    if (!r.ok) throw wrongPassword(r);
    const token = auth.createSession();
    sendJson(res, 200, { ok: true, autoLockMinutes: vault.settings.autoLockMinutes }, {
      "set-cookie": sessionCookie(token, cookieOpts(req)),
    });
  }

  /** Forgot the password: the recovery key opens the vault under a new one. */
  async function recover(req, res) {
    const body = await readJson(req);
    if (!(await vault.initialized())) throw new HttpError(409, "no_vault", "No password set yet");
    if (!(await vault.canRecover())) {
      throw new HttpError(409, "no_recovery", "This vault has no recovery key: only its password opens it");
    }
    // Before the throttle: a short password or a typo the checksum catches is
    // not a guess.
    checkNewPassword(body.password);
    parseRecoveryKey(body.recoveryKey).fill(0);
    const r = await auth.attempt(ipKey(req), () => vault.recover(body.recoveryKey, body.password));
    if (!r.ok) {
      if (r.reason === "wait") throw wrongPassword(r);
      throw new HttpError(403, "wrong_recovery_key", "That is not this vault's recovery key", {
        retryAfterMs: r.retryAfterMs, failures: r.failures,
      });
    }
    // The old password opens nothing now: every other session ends.
    const token = auth.createSession();
    auth.keepOnly(token);
    sendJson(res, 200, { ok: true, autoLockMinutes: vault.settings.autoLockMinutes }, {
      "set-cookie": sessionCookie(token, cookieOpts(req)),
    });
  }

  async function newRecoveryKey(req, res) {
    const token = requireSession(req);
    const body = await readJson(req);
    await requirePassword(token, body.password);
    const recoveryKey = await vault.newRecoveryKey(body.password);
    auth.touch();
    sendJson(res, 200, { recoveryKey });
  }

  async function lock(req, res) {
    requireSession(req);
    auth.lock("manual");
    sendJson(res, 200, { ok: true }, { "set-cookie": sessionCookie(null, cookieOpts(req)) });
  }

  async function activity(req, res) {
    requireSession(req);
    auth.touch();
    sendJson(res, 200, { ok: true, autoLockMinutes: vault.settings.autoLockMinutes });
  }

  async function changePassword(req, res) {
    const token = requireSession(req);
    const body = await readJson(req);
    const r = await auth.attempt(Auth.sessionKey(token), () => vault.verify(body.current));
    if (!r.ok) throw wrongPassword(r);
    await vault.changePassword(body.current, body.next);
    auth.keepOnly(token);
    auth.touch();
    sendJson(res, 200, { ok: true });
  }

  async function settings(req, res) {
    requireSession(req);
    const body = await readJson(req);
    const next = await vault.updateSettings({ autoLockMinutes: body.autoLockMinutes });
    auth.touch();
    sendJson(res, 200, { ok: true, ...next, choices: AUTO_LOCK_CHOICES });
  }

  async function runtimeConfig(req, res) {
    requireSession(req);
    sendJson(res, 200, {
      apiBase: config.apiBase,
      routerBase: config.routerBase,
      routerEvmBase: config.routerEvmBase,
      rpcHost: hostOnly(config.rpcUrl),
      evmRpcHosts: Object.fromEntries(Object.entries(config.evmRpc).map(([c, r]) => [c, hostOnly(r.http)])),
      apiKeyConfigured: Boolean(config.apiKey),
      vaultFile: vault.file,
      recoveryKeySet: vault.hasRecoveryKey,
      autoLockChoices: AUTO_LOCK_CHOICES,
      autoLockMinutes: vault.settings.autoLockMinutes,
      desktop: config.desktop,
      version,
    });
  }

  async function listWallets(req, res) {
    requireSession(req);
    sendJson(res, 200, { wallets: vault.list() });
  }

  async function generate(req, res) {
    requireSession(req);
    const body = await readJson(req);
    const wallets = await vault.generate(body.family, { label: body.label, count: body.count ?? 1 });
    auth.touch();
    sendJson(res, 200, { wallets });
  }

  async function importWallets(req, res) {
    requireSession(req);
    const body = await readJson(req);
    const out = await vault.import(body.items);
    auth.touch();
    sendJson(res, 200, out);
  }

  /** The router's quote, kept here; errors in the router's own shape
   *  (`{ error, reason }`), which the quote panels read. */
  async function swapQuote(req, res) {
    requireSession(req);
    const url = new URL(req.url || "/", "http://local");
    try {
      const out = await quotes.quote(url.searchParams);
      sendJson(res, out.status, out.body);
    } catch (e) {
      if (!(e instanceof QuoteError)) throw e;
      sendJson(res, e.status, { error: e.code, reason: e.message });
    }
  }

  /** The EVM router's quote, kept here; errors as `{ error: { code, message } }`. */
  async function evmQuote(req, res) {
    requireSession(req);
    const url = new URL(req.url || "/", "http://local");
    const out = await evm.quote(url.searchParams);
    sendJson(res, out.status, out.body);
  }

  async function evmBalance(req, res) {
    requireSession(req);
    const sp = new URL(req.url || "/", "http://local").searchParams;
    sendJson(res, 200, await evm.balance(sp.get("chain") || "", sp.get("owner") || "", sp.get("token") || ""));
  }

  /** Held open until the receipt (or the timeout): the lock ends it. */
  async function evmConfirm(req, res) {
    requireSession(req);
    const body = await readJson(req);
    const gone = new AbortController();
    res.once("close", () => gone.abort());
    sendJson(res, 200, await evm.confirm(String(body.chain || ""), body.hash, { signal: gone.signal }));
  }

  async function walletRoute(req, res, id, action) {
    const token = requireSession(req);
    if (!action && req.method === "PATCH") {
      const body = await readJson(req);
      const wallet = await vault.rename(id, body.label);
      auth.touch();
      return sendJson(res, 200, { wallet });
    }
    if (req.method !== "POST" || !action) throw new HttpError(405, "bad_request", "Method not allowed");
    const body = await readJson(req);
    const w = vault.get(id);
    try {
      return await walletAction(req, res, token, w, action, body);
    } finally {
      // This copy of the key is not needed past the request.
      w.secret?.fill(0);
    }
  }

  async function walletAction(req, res, token, w, action, body) {
    const id = w.id;
    // Not just "the vault is unlocked": this request's own session still
    // lives. A lock ends it, and an unlock elsewhere does not bring it back.
    const stillUnlocked = () => auth.sessionOf(req) === token;
    if (action === "delete") {
      // A wallet with a key is money: the password again, like a device asks.
      if (!w.watchOnly) await requirePassword(token, body.password);
      await vault.remove(id);
      auth.touch();
      return sendJson(res, 200, { ok: true });
    }
    if (action === "export") {
      if (w.watchOnly) throw new HttpError(400, "watch_only", "Watch-only wallet: there is no key to export");
      await requirePassword(token, body.password);
      auth.touch();
      return sendJson(res, 200, { id: w.id, family: w.family, address: w.address, ...exportFormats(w.family, w.secret) });
    }
    if (w.watchOnly) throw new HttpError(400, "watch_only", "Watch-only wallet: import its key to trade or send");
    if (w.family === "evm") {
      if (action !== "swap") throw new HttpError(400, "unsupported_chain", "Sending runs on Solana for now: EVM wallets swap");
      const kept = evm.book.get(body.quoteToken);
      if (!kept) throw new HttpError(409, "quote_expired", "That quote expired: get a new one");
      auth.touch();
      return sendJson(res, 200, await evm.swap(w, kept, { stillUnlocked }));
    }
    if (w.family !== "sol") throw new HttpError(400, "unsupported_chain", "Unknown wallet type");
    if (action === "swap") {
      const quote = quotes.book.get(body.quoteToken);
      if (!quote) throw new HttpError(409, "quote_expired", "That quote expired: get a new one");
      auth.touch();
      const out = await solana.swap(w, { quote, priorityFeeLamports: body.priorityFeeLamports }, { stillUnlocked });
      return sendJson(res, 200, out);
    }
    if (action === "send") {
      await requirePassword(token, body.password);
      auth.touch();
      const out = await solana.transfer(w, String(body.to || "").trim(), body.amount === "max" ? "max" : String(body.lamports ?? ""), { stillUnlocked });
      return sendJson(res, 200, out);
    }
    throw new HttpError(404, "not_found", "Not found");
  }

  const routes = {
    "GET /api/auth/status": status,
    "POST /api/auth/setup": setup,
    "POST /api/auth/unlock": unlock,
    "POST /api/auth/recover": recover,
    "POST /api/auth/recovery-key": newRecoveryKey,
    "POST /api/auth/lock": lock,
    "POST /api/auth/activity": activity,
    "POST /api/auth/password": changePassword,
    "POST /api/auth/settings": settings,
    "GET /api/config": runtimeConfig,
    "GET /api/swap/quote": swapQuote,
    "GET /api/evm/quote": evmQuote,
    "GET /api/evm/balance": evmBalance,
    "POST /api/evm/confirm": evmConfirm,
    "GET /api/wallets": listWallets,
    "POST /api/wallets/generate": generate,
    "POST /api/wallets/import": importWallets,
  };

  /**
   * Answer `req` if it is one of these routes.
   * @returns {Promise<boolean>} false when the path is not ours
   */
  return async function handle(req, res, pathname) {
    const fn = routes[`${req.method} ${pathname}`];
    const m = fn ? null : WALLET_ROUTE.exec(pathname);
    const ours = fn || m || pathname.startsWith("/api/auth/") || pathname === "/api/wallets" || pathname.startsWith("/api/wallets/")
      || pathname.startsWith("/api/evm/");
    if (!ours) return false;
    try {
      if (fn) await fn(req, res);
      else if (m) await walletRoute(req, res, m[1], m[2]);
      else throw new HttpError(404, "not_found", "Not found");
    } catch (e) {
      if (res.headersSent) {
        res.destroy();
        return true;
      }
      if (e instanceof HttpError) sendError(res, e.status, e.code, e.message, e.extra);
      else if (e instanceof VaultError) sendError(res, e.status, e.code, e.message);
      else if (e instanceof KeyError) sendError(res, 400, e.code, e.message);
      else if (e instanceof SolanaError) sendError(res, e.status, e.code, e.message);
      else if (e instanceof EvmError) sendError(res, e.status, e.code, e.message);
      else if (e instanceof QuoteError) sendError(res, e.status, e.code, e.message);
      else {
        console.error("[trade-ui] request failed:", e);
        sendError(res, 500, "internal", "Something went wrong on the server");
      }
    }
    return true;
  };
}
