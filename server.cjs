"use strict";
/**
 * Production server: Next.js + a WebSocket proxy to the market-data API.
 *
 * The browser connects to same-origin `/api/ws`; this process upgrades that
 * socket and forwards it to `${RAZE_API_BASE}/v1/ws` (ws:// or wss:// by the
 * base's scheme), adding `x-api-key` from RAZE_API_KEY. The key never reaches
 * the browser. Pages not allowed to open a cross-origin socket (Cursor's Simple
 * Browser, an https page against an http API) work the same way.
 */
const { createServer } = require("node:http");
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const next = require("next");

function loadEnvFile(file) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] == null || process.env[k] === "") process.env[k] = v;
  }
}

loadEnvFile(path.join(__dirname, ".env.local"));

// Tells /api/session that same-origin `/api/ws` is served here.
process.env.TRADE_UI_WS_PROXY = "1";

const port = Number(process.env.PORT || 3000);
const DEFAULT_BASE = "https://api.raze.bot";

const app = next({ dev: false, hostname: "0.0.0.0", port });
const handle = app.getRequestHandler();

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ""; }
    }
  }
  return "";
}

/** Same precedence as the REST proxy: .env.local, then the Settings cookie. */
function upstreamFor(req) {
  const envBase = (process.env.RAZE_API_BASE || "").trim();
  const envKey = (process.env.RAZE_API_KEY || "").trim();
  const base = (envBase || readCookie(req, "trade_ui_api_base") || DEFAULT_BASE).replace(/\/+$/, "");
  const key = envKey || readCookie(req, "trade_ui_api_key");
  return { base: new URL(base), key };
}

// Headers that describe the browser's hop, not the upstream request.
const DROP = new Set([
  "host", "cookie", "origin", "authorization", "x-api-key",
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "content-length",
]);

function rejectUpgrade(socket, status, message) {
  try {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch { /* ignore */ }
  try { socket.destroy(); } catch { /* ignore */ }
}

function proxyUpgrade(req, socket, head) {
  let target;
  try {
    target = upstreamFor(req);
  } catch {
    rejectUpgrade(socket, 502, "Bad Gateway");
    return;
  }
  const { base, key } = target;
  const secure = base.protocol === "https:" || base.protocol === "wss:";

  // Upgrade-URL parameters (`?channel=trades&chain=sol&token=…`) subscribe
  // immediately on the API; pass them through, minus any key.
  const params = new URLSearchParams();
  try {
    new URL(req.url || "/", "http://localhost").searchParams.forEach((v, k) => {
      if (k !== "api_key" && k !== "apiKey") params.set(k, v);
    });
  } catch { /* ignore */ }
  const qs = params.toString();
  const destPath = `${base.pathname.replace(/\/+$/, "")}/v1/ws${qs ? `?${qs}` : ""}`;

  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value == null || DROP.has(name.toLowerCase())) continue;
    headers[name] = value;
  }
  headers.host = base.host;
  if (key) headers["x-api-key"] = key;

  const upstream = (secure ? https : http).request({
    protocol: secure ? "https:" : "http:",
    hostname: base.hostname,
    port: base.port || (secure ? 443 : 80),
    path: destPath,
    method: "GET",
    headers,
    servername: secure ? base.hostname : undefined,
    timeout: 10_000,
  });

  let settled = false;
  const fail = (status, message) => {
    if (settled) return;
    settled = true;
    rejectUpgrade(socket, status, message);
  };
  socket.on("error", () => { try { upstream.destroy(); } catch { /* ignore */ } });

  upstream.on("timeout", () => {
    upstream.destroy();
    fail(504, "Gateway Timeout");
  });
  upstream.on("error", () => fail(502, "Bad Gateway"));
  // Not a 101: the API refused (401 without a valid key, 429, …). Relay the
  // status so the browser's socket fails fast and the client falls back.
  upstream.on("response", (res) => {
    res.resume();
    fail(res.statusCode || 502, res.statusMessage || "Bad Gateway");
  });
  upstream.on("upgrade", (res, upSocket, upHead) => {
    if (settled) {
      upSocket.destroy();
      return;
    }
    settled = true;
    let out = "HTTP/1.1 101 Switching Protocols\r\n";
    const raw = res.rawHeaders || [];
    for (let i = 0; i < raw.length; i += 2) out += `${raw[i]}: ${raw[i + 1]}\r\n`;
    out += "\r\n";
    socket.write(out);
    if (upHead && upHead.length) socket.write(upHead);
    if (head && head.length) upSocket.write(head);
    upSocket.setNoDelay(true);
    if (typeof socket.setNoDelay === "function") socket.setNoDelay(true);
    upSocket.setTimeout(0);
    // An error tears both hops down; a close only ends the other hop, so
    // whatever is still buffered (a Close frame) is flushed first.
    const destroyBoth = () => {
      try { upSocket.destroy(); } catch { /* ignore */ }
      try { socket.destroy(); } catch { /* ignore */ }
    };
    upSocket.on("error", destroyBoth);
    socket.on("error", destroyBoth);
    upSocket.on("close", () => { try { socket.end(); } catch { /* ignore */ } });
    socket.on("close", () => { try { upSocket.end(); } catch { /* ignore */ } });
    upSocket.pipe(socket);
    socket.pipe(upSocket);
  });
  upstream.end();
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  server.on("upgrade", (req, socket, head) => {
    const pathname = String(req.url || "").split("?")[0];
    if (pathname === "/api/ws") {
      proxyUpgrade(req, socket, head);
      return;
    }
    socket.destroy();
  });
  server.listen(port, () => {
    console.log(`> trade-ui ready on http://127.0.0.1:${port}`);
  });
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
