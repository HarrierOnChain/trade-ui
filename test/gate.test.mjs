/**
 * The server's front door over real HTTP: setup, unlock, sessions, the
 * cross-site and host checks, the wallet routes, kept quotes, the WebSocket
 * proxy, and what a lock ends. Next.js is replaced by a handler that answers
 * "next" ("next gated" when the gate's secret header came with the request);
 * one local server plays the API's WebSocket and the router.
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { hostAllowed, loadConfig } from "../server/config.mjs";
import { formatRecoveryKey, Vault } from "../server/vault.mjs";
import { Auth, SESSION_COOKIE } from "../server/auth.mjs";
import { createApi } from "../server/api.mjs";
import { createGate, GATE_HEADER } from "../server/gate.mjs";
import { createQuotes } from "../server/quotes.mjs";
import { createSolana } from "../server/solana.mjs";
import { generateKey, toBase58 } from "../server/keys.mjs";

const PW = "correct horse battery";
const SECRET = "gate-secret-for-tests";
const QUOTE = JSON.parse(await fs.readFile(new URL("../src/lib/swap/fixtures/quote-sol-usdc.json", import.meta.url), "utf8"));
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RECOVERY_RE = /^(?:[0-9A-Z]{4}-){8}[0-9A-Z]{4}$/;
let dir, server, base, upstream, upstreamSockets = [], routerSeen = [], recoveryKey = "";

function listen(srv) {
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(srv.address().port)));
}

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "trade-ui-gate-"));
  // The router: a quote, and a build it refuses (nothing gets signed here).
  upstream = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    routerSeen.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
    res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/quote?")) return res.end(JSON.stringify(QUOTE));
    if (req.url === "/swap-instructions") {
      res.statusCode = 409;
      return res.end(JSON.stringify({ reason: "stale" }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  // The API's WebSocket: answers the upgrade, then echoes; "slow" never answers.
  upstream.on("upgrade", (req, socket) => {
    upstreamSockets.push({ headers: req.headers, url: req.url, socket });
    if (req.url.includes("slow")) return;
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (d) => socket.write(d));
  });
  const upPort = await listen(upstream);

  const env = {
    RAZE_API_KEY: "k_secret",
    RAZE_API_BASE: `http://127.0.0.1:${upPort}`,
    RAZE_ROUTER_BASE: `http://127.0.0.1:${upPort}`,
    TRADE_UI_DATA_DIR: dir,
    TRADE_UI_SETUP_TOKEN: "setup-code-123",
  };
  const config = loadConfig({ root: dir, argv: [], env });
  const vault = new Vault({ dir, kdf: { N: 1 << 10, r: 8, p: 1 } });
  const quotes = createQuotes(config);
  let gate;
  const auth = new Auth({ vault, onLock: () => { gate.closeSockets(); quotes.book.clear(); } });
  const api = createApi({ vault, auth, solana: createSolana(config), quotes, config, setupToken: () => config.setupToken, version: "test" });
  const next = (req, res) => {
    // A stream that stays open, like the API's SSE through the REST proxy.
    if (req.url.startsWith("/api/raze/hold")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": open\n\n");
      return;
    }
    res.end(req.headers[GATE_HEADER] === SECRET ? "next gated" : "next");
  };
  gate = createGate({ config, auth, api, next, secret: SECRET });
  server = http.createServer((req, res) => gate.onRequest(req, res));
  server.on("upgrade", gate.onUpgrade);
  base = `http://127.0.0.1:${await listen(server)}`;
});

after(async () => {
  server.closeAllConnections?.();
  upstream.closeAllConnections?.();
  server.close();
  upstream.close();
  await fs.rm(dir, { recursive: true, force: true });
});

let cookie = "";
async function call(method, p, body, { headers = {}, auth = true } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  if (method !== "GET" && !("x-trade-ui" in h)) h["x-trade-ui"] = "1";
  if (auth && cookie) h.cookie = cookie;
  const r = await fetch(`${base}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.get("set-cookie");
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* text */ }
  return { status: r.status, json, text, set };
}

function takeCookie(set) {
  const m = new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(set || "");
  assert.ok(m && m[1], "a session cookie");
  cookie = `${SESSION_COOKIE}=${m[1]}`;
}

/** A GET with any Host header (fetch() will not send another one). */
function getWithHost(host, p = "/api/auth/status", headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    http.get({ host: u.hostname, port: u.port, path: p, headers: { ...headers, host } }, (res) => {
      let text = "";
      res.on("data", (d) => { text += d; });
      res.on("end", () => resolve({ status: res.statusCode, text }));
    }).on("error", reject);
  });
}

/** A raw WebSocket handshake; resolves with the status line and the socket. */
function upgrade(p, extra = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const s = net.connect(Number(u.port), u.hostname, () => {
      const lines = [
        `GET ${p} HTTP/1.1`, `Host: ${u.host}`, "Upgrade: websocket", "Connection: Upgrade",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version: 13",
        ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`), "", "",
      ];
      s.write(lines.join("\r\n"));
    });
    s.once("data", (d) => resolve({ status: d.toString().split("\r\n")[0], socket: s }));
    s.on("error", reject);
  });
}

describe("the gate", () => {
  test("first run: setup needs the setup code", async () => {
    let r = await call("GET", "/api/auth/status");
    assert.deepEqual([r.json.initialized, r.json.unlocked, r.json.apiKeyConfigured], [false, false, true]);
    assert.ok(!r.text.includes("k_secret"));
    r = await call("POST", "/api/auth/setup", { password: PW, setupToken: "guess" });
    assert.equal(r.json.error.code, "bad_setup_token");
    r = await call("POST", "/api/auth/setup", { password: PW, setupToken: "setup-code-123" });
    assert.equal(r.status, 200);
    assert.match(r.set, /HttpOnly; SameSite=Strict/);
    // The recovery key comes back once, with the first session.
    assert.match(r.json.recoveryKey, RECOVERY_RE);
    recoveryKey = r.json.recoveryKey;
    takeCookie(r.set);
    assert.equal((await call("GET", "/api/auth/status")).json.recovery, true);
    r = await call("POST", "/api/auth/setup", { password: PW, setupToken: "setup-code-123" });
    assert.equal(r.json.error.code, "vault_exists");
  });

  test("everything under /api needs the session; pages do not", async () => {
    assert.equal((await call("GET", "/api/raze/chains", undefined, { auth: false })).json.error.code, "locked");
    assert.equal((await call("GET", "/api/raze/chains")).text, "next gated");
    assert.equal((await call("GET", "/monitor", undefined, { auth: false })).text, "next");
    assert.equal((await call("GET", "/api/wallets", undefined, { auth: false })).status, 401);
  });

  test("the gate's header reaches Next only from the gate", async () => {
    const forged = { headers: { [GATE_HEADER]: SECRET } };
    assert.equal((await call("GET", "/monitor", undefined, { ...forged, auth: false })).text, "next");
    assert.equal((await call("GET", "/api/raze/chains", undefined, { ...forged, auth: false })).status, 401);
  });

  test("writes need the header and a same-site Origin; other hosts are refused", async () => {
    let r = await call("POST", "/api/wallets/generate", { family: "sol" }, { headers: { "x-trade-ui": "" } });
    assert.equal(r.json.error.code, "forbidden");
    r = await call("POST", "/api/wallets/generate", { family: "sol" }, { headers: { origin: "https://evil.example" } });
    assert.equal(r.json.error.code, "forbidden");
    const rebound = await getWithHost("rebind.evil.example");
    assert.equal(rebound.status, 403);
    assert.match(rebound.text, /TRADE_UI_PUBLIC_URL/);
    // Even a server listening on all interfaces answers names only when told to.
    assert.equal((await getWithHost("trade.example.com:3000")).status, 403);
    assert.equal((await getWithHost("localhost:3000")).status, 200);
    assert.equal((await getWithHost("203.0.113.9:3000")).status, 200);
    assert.equal((await getWithHost("[::1]:3000")).status, 200);
  });

  test("host names: localhost and IP literals, the rest only when configured", () => {
    const cfg = (env) => loadConfig({ root: dir, argv: [], env: { TRADE_UI_DATA_DIR: dir, ...env } });
    const open = cfg({ HOST: "0.0.0.0" });
    assert.equal(hostAllowed(open, "localhost:3000"), true);
    assert.equal(hostAllowed(open, "[::1]:3000"), true);
    assert.equal(hostAllowed(open, "10.0.0.5:3000"), true);
    assert.equal(hostAllowed(open, "trade.example.com"), false);
    assert.equal(hostAllowed(open, "localhost.evil.example"), false);
    assert.equal(hostAllowed(open, ""), false);
    const named = cfg({ TRADE_UI_PUBLIC_URL: "https://trade.example.com", TRADE_UI_ALLOWED_HOSTS: "Box.Lan:8080" });
    assert.equal(hostAllowed(named, "trade.example.com"), true);
    assert.equal(hostAllowed(named, "box.lan:8080"), true);
    assert.equal(hostAllowed(named, "box.lan:9090"), false);
    assert.equal(hostAllowed(named, "other.example.com"), false);
  });

  test("wallets: generate, import, list without secrets, export with the password", async () => {
    let r = await call("POST", "/api/wallets/generate", { family: "sol", label: "Main" });
    assert.equal(r.status, 200);
    const [w] = r.json.wallets;
    const k = generateKey("sol");
    r = await call("POST", "/api/wallets/import", { items: [{ secret: toBase58(k.secret) }, { address: generateKey("sol").address }] });
    assert.equal(r.json.created.length, 1);
    assert.deepEqual(r.json.errors.map((e) => e.code), ["bad_request"]);
    r = await call("GET", "/api/wallets");
    assert.equal(r.json.wallets.length, 2);
    assert.ok(!r.text.includes(toBase58(k.secret)));

    r = await call("POST", `/api/wallets/${w.id}/export`, {});
    assert.equal(r.json.error.code, "password_required");
    r = await call("POST", `/api/wallets/${w.id}/export`, { password: "wrong password" });
    assert.equal(r.status, 403);
    r = await call("POST", `/api/wallets/${w.id}/export`, { password: PW });
    assert.equal(r.json.address, w.address);
    assert.equal(r.json.base58.length > 80, true);

    r = await call("PATCH", `/api/wallets/${w.id}`, { label: "Renamed" });
    assert.equal(r.json.wallet.label, "Renamed");
    r = await call("POST", `/api/wallets/${w.id}/delete`, { password: "wrong password" });
    assert.equal(r.status, 403);
    assert.equal((await call("GET", "/api/wallets")).json.wallets.length, 2);
  });

  test("quotes stay on the server: the swap is built from the router's own quote", async () => {
    const wallet = (await call("GET", "/api/wallets")).json.wallets.find((w) => w.family === "sol");
    const qs = `inputMint=${SOL}&outputMint=${USDC}&amount=1000000&slippageBps=50&maxHops=2&apiKey=leak`;
    let r = await call("GET", `/api/swap/quote?${qs}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.outAmount, QUOTE.outAmount);
    assert.match(r.json.quoteToken, /^[A-Za-z0-9_-]{16,}$/);
    const asked = routerSeen.at(-1);
    assert.equal(asked.headers["x-api-key"], "k_secret");
    assert.equal(asked.url, `/quote?inputMint=${SOL}&outputMint=${USDC}&amount=1000000&slippageBps=50&maxHops=2`);

    r = await call("GET", `/api/swap/quote?inputMint=${SOL}&outputMint=${USDC}&amount=1&slippageBps=9000`);
    assert.deepEqual([r.status, r.json.error], [400, "slippage_cap"]);
    r = await call("GET", `/api/swap/quote?inputMint=${SOL}&outputMint=${SOL}&amount=1`);
    assert.deepEqual([r.status, r.json.error], [400, "bad_request"]);

    const token = (await call("GET", `/api/swap/quote?${qs}`)).json.quoteToken;
    r = await call("POST", `/api/wallets/${wallet.id}/swap`, { quoteToken: "made-up" });
    assert.deepEqual([r.status, r.json.error.code], [409, "quote_expired"]);
    // A quote sent along is ignored: the router gets the one it gave.
    const tampered = { ...QUOTE, otherAmountThreshold: "0", slippageBps: 10_000 };
    r = await call("POST", `/api/wallets/${wallet.id}/swap`, { quoteToken: token, quote: tampered, priorityFeeLamports: 1000 });
    assert.equal(r.status, 409);
    assert.match(r.json.error.message, /changed since the quote \(stale\)/);
    const built = routerSeen.at(-1);
    assert.equal(built.url, "/swap-instructions");
    assert.equal(built.headers["x-api-key"], "k_secret");
    assert.deepEqual(built.body.quoteResponse, QUOTE);
    assert.equal(built.body.userPublicKey, wallet.address);
    assert.equal(built.body.prioritizationFeeLamports, 1000);
  });

  test("the WebSocket proxy: refused without a session, keyed with one, closed by the lock", async () => {
    const refused = await upgrade("/api/ws?channel=prices");
    assert.match(refused.status, / 401 /);
    refused.socket.destroy();

    const cross = await upgrade("/api/ws", { Cookie: cookie, Origin: "https://evil.example" });
    assert.match(cross.status, / 403 /);
    cross.socket.destroy();

    const ok = await upgrade("/api/ws?channel=prices&apiKey=leak", { Cookie: cookie });
    assert.match(ok.status, / 101 /);
    const seen = upstreamSockets.at(-1);
    assert.equal(seen.headers["x-api-key"], "k_secret");
    assert.equal(seen.headers.cookie, undefined);
    assert.equal(seen.url, "/ws?channel=prices");
    const closed = new Promise((resolve) => ok.socket.on("close", resolve));
    const r = await call("POST", "/api/auth/lock", {});
    assert.equal(r.status, 200);
    await closed;
  });

  test("a lock also ends open streams and handshakes still waiting for the upstream", { timeout: 10_000 }, async () => {
    const r = await call("POST", "/api/auth/unlock", { password: PW });
    takeCookie(r.set);
    const token = (await call("GET", `/api/swap/quote?inputMint=${SOL}&outputMint=${USDC}&amount=5`)).json.quoteToken;
    const wallet = (await call("GET", "/api/wallets")).json.wallets.find((w) => w.family === "sol");

    const stream = await new Promise((resolve, reject) => {
      const u = new URL(base);
      http.get({ host: u.hostname, port: u.port, path: "/api/raze/hold", headers: { cookie } }, (res) => {
        res.once("data", () => resolve(res));
      }).on("error", reject);
    });
    const streamEnded = new Promise((resolve) => stream.on("close", resolve));

    const before = upstreamSockets.length;
    const u = new URL(base);
    const waiting = net.connect(Number(u.port), u.hostname);
    waiting.write([
      "GET /api/ws?channel=slow HTTP/1.1", `Host: ${u.host}`, "Upgrade: websocket", "Connection: Upgrade",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version: 13", `Cookie: ${cookie}`, "", "",
    ].join("\r\n"));
    while (upstreamSockets.length === before) await new Promise((res) => setTimeout(res, 10));
    // The upstream server keeps its half open: the far end leaving is "end".
    const upstreamEnded = new Promise((resolve) => upstreamSockets.at(-1).socket.on("end", resolve));
    const waitingEnded = new Promise((resolve) => waiting.on("close", resolve));

    assert.equal((await call("POST", "/api/auth/lock", {})).status, 200);
    await Promise.all([streamEnded, waitingEnded, upstreamEnded]);

    // Kept quotes go with the lock.
    takeCookie((await call("POST", "/api/auth/unlock", { password: PW })).set);
    const after = await call("POST", `/api/wallets/${wallet.id}/swap`, { quoteToken: token });
    assert.equal(after.json.error.code, "quote_expired");
    await call("POST", "/api/auth/lock", {});
  });

  test("after the lock: the old session is dead, the password brings a new one", async () => {
    assert.equal((await call("GET", "/api/wallets")).json.error.code, "locked");
    assert.equal((await call("GET", "/api/auth/status")).json.unlocked, false);
    let r = await call("POST", "/api/auth/unlock", { password: "wrong password" });
    assert.equal(r.json.error.code, "bad_password");
    r = await call("POST", "/api/auth/unlock", { password: PW });
    assert.equal(r.status, 200);
    takeCookie(r.set);
    assert.equal((await call("GET", "/api/wallets")).json.wallets.length, 2);
    assert.equal((await call("GET", "/api/auth/status")).json.unlocked, true);
  });

  test("config shows where it talks to, never the key", async () => {
    const r = await call("GET", "/api/config");
    assert.equal(r.json.apiKeyConfigured, true);
    assert.ok(!r.text.includes("k_secret"));
  });

  test("a forgotten password: the recovery key sets a new one and ends the other sessions", async () => {
    let r = await call("POST", "/api/auth/recover", { recoveryKey: "ABCD-EFGH", password: "a new password" }, { auth: false });
    assert.deepEqual([r.status, r.json.error.code], [400, "bad_recovery_key"]);
    r = await call("POST", "/api/auth/recover", { recoveryKey, password: "short" }, { auth: false });
    assert.deepEqual([r.status, r.json.error.code], [400, "weak_password"]);
    r = await call("POST", "/api/auth/recover", { recoveryKey: formatRecoveryKey(crypto.randomBytes(20)), password: "a new password" }, { auth: false });
    assert.deepEqual([r.status, r.json.error.code, r.json.error.failures], [403, "wrong_recovery_key", 1]);
    r = await call("POST", "/api/auth/recover", { recoveryKey, password: "a new password" }, { headers: { "x-trade-ui": "" }, auth: false });
    assert.equal(r.json.error.code, "forbidden");

    r = await call("POST", "/api/auth/recover", { recoveryKey, password: "a new password" }, { auth: false });
    assert.equal(r.status, 200);
    const old = cookie;
    takeCookie(r.set);
    assert.equal((await call("GET", "/api/wallets", undefined, { headers: { cookie: old }, auth: false })).status, 401);
    assert.equal((await call("GET", "/api/wallets")).json.wallets.length, 2);
    assert.equal((await call("POST", "/api/auth/unlock", { password: PW })).json.error.code, "bad_password");
    assert.equal((await call("POST", "/api/auth/unlock", { password: "a new password" })).status, 200);
  });

  test("a new recovery key: a session and the password again; the old key stops working", async () => {
    assert.equal((await call("POST", "/api/auth/recovery-key", { password: "a new password" }, { auth: false })).status, 401);
    let r = await call("POST", "/api/auth/recovery-key", { password: "wrong password" });
    assert.equal(r.status, 403);
    r = await call("POST", "/api/auth/recovery-key", { password: "a new password" });
    assert.match(r.json.recoveryKey, RECOVERY_RE);
    const next = r.json.recoveryKey;
    assert.equal((await call("GET", "/api/config")).json.recoveryKeySet, true);
    r = await call("POST", "/api/auth/recover", { recoveryKey, password: "a newer password" }, { auth: false });
    assert.equal(r.json.error.code, "wrong_recovery_key");
    r = await call("POST", "/api/auth/recover", { recoveryKey: next, password: "a newer password" }, { auth: false });
    assert.equal(r.status, 200);
  });
});
