"use strict";
/**
 * Production server: Next.js + WebSocket proxy to evmapi.
 *
 * Cursor's Simple Browser (and any page not allowed to open ws://:8810)
 * can connect to same-origin `/api/ws`. This process upgrades that socket
 * and forwards it to evmapi `/ws`, injecting RAZE_API_KEY from .env.local.
 */
const { createServer } = require("node:http");
const { createConnection } = require("node:net");
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

const port = Number(process.env.PORT || 3000);
const evmHost = "127.0.0.1";
const evmPort = Number(new URL(process.env.RAZE_API_BASE || "http://127.0.0.1:8810").port || 8810);

const app = next({ dev: false, hostname: "0.0.0.0", port });
const handle = app.getRequestHandler();

function proxyUpgrade(req, socket, head) {
  const key = (process.env.RAZE_API_KEY || "").trim();
  const dest = createConnection({ host: evmHost, port: evmPort });
  const fail = () => {
    try { dest.destroy(); } catch { /* ignore */ }
    try { socket.destroy(); } catch { /* ignore */ }
  };
  const connectTimer = setTimeout(fail, 4_000);
  dest.setNoDelay(true);
  dest.on("error", fail);
  socket.on("error", fail);
  socket.on("close", fail);
  dest.on("close", () => {
    try { socket.destroy(); } catch { /* ignore */ }
  });
  dest.on("connect", () => {
    clearTimeout(connectTimer);
    const params = new URLSearchParams();
    try {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      u.searchParams.forEach((v, k) => {
        if (k !== "api_key") params.set(k, v);
      });
    } catch { /* ignore */ }
    if (key) params.set("api_key", key);
    const qs = params.toString();
    const destPath = "/ws" + (qs ? `?${qs}` : "");
    let out = `GET ${destPath} HTTP/1.1\r\n`;
    const raw = req.rawHeaders || [];
    for (let i = 0; i < raw.length; i += 2) {
      const name = raw[i];
      const val = raw[i + 1];
      if (!name || name.toLowerCase() === "host") continue;
      out += `${name}: ${val}\r\n`;
    }
    out += `Host: ${evmHost}:${evmPort}\r\n`;
    if (key) out += `x-api-key: ${key}\r\n`;
    out += "\r\n";
    dest.write(out);
    if (head && head.length) dest.write(head);
    dest.pipe(socket);
    socket.pipe(dest);
  });
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
