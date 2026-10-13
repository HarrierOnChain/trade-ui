/**
 * Trade UI server: Next.js behind a lock.
 *
 *   node server.mjs          production (after `npm run build`)
 *   node server.mjs --dev    development, hot reload
 *
 * Everything under `/api/` needs a session, given out for the vault's
 * password (server/api.mjs, server/gate.mjs): the proxies that carry the Raze
 * API key (`/api/raze/*`, `/api/ws`), the routers (Solana and EVM), the RPCs
 * and the wallets. Pages and static files are public: they are the open-source app,
 * and show the lock screen until the browser is unlocked.
 *
 * Configuration comes from the environment and `.env` (server/config.mjs).
 */
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./server/config.mjs";
import { Vault } from "./server/vault.mjs";
import { Auth } from "./server/auth.mjs";
import { createSolana } from "./server/solana.mjs";
import { createQuotes } from "./server/quotes.mjs";
import { createEvm } from "./server/evm.mjs";
import { createLaunch } from "./server/launch.mjs";
import { createLaunchMedia } from "./server/launchMedia.mjs";
import { createApi, sendError } from "./server/api.mjs";
import { createGate } from "./server/gate.mjs";
import { silenceOkRequestLogs } from "./server/dev-log.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
let config;
try {
  config = loadConfig({ root });
} catch (e) {
  console.error(`[trade-ui] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
process.env.NODE_ENV = config.dev ? "development" : "production";
if (config.dev) silenceOkRequestLogs();

// The Next.js route handlers run in this process and read these.
process.env.RAZE_API_BASE = config.apiBase;
process.env.RAZE_ROUTER_BASE = config.routerBase;
process.env.SOLANA_RPC_URL = config.rpcUrl;
if (config.apiKey) process.env.RAZE_API_KEY = config.apiKey;
// Route handlers serve only requests that carry this, set by the gate after
// the session check (src/lib/server/gate.ts).
const gateSecret = crypto.randomBytes(32).toString("hex");
globalThis[Symbol.for("trade-ui.gate")] = gateSecret;

const VERSION = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version || "0.0.0";

let gate;
const vault = new Vault({ dir: config.dataDir });
const quotes = createQuotes(config);
const evm = createEvm(config);
const solana = createSolana(config);
const launch = createLaunch(config, { solana, evm });
const media = createLaunchMedia();
const auth = new Auth({
  vault,
  onLock: (reason) => {
    gate?.closeSockets();
    quotes.book.clear();
    evm.book.clear();
    launch.clear();
    console.log(`[trade-ui] locked (${reason})`);
  },
});
auth.startIdleTimer();

const api = createApi({ vault, auth, solana, quotes, evm, launch, media, config, setupToken: () => config.setupToken, version: VERSION });

const { default: next } = await import("next");
let conf;
if (!config.dev) {
  // The serialized config of the build: no next.config.ts compile at start,
  // and the same server runs from the standalone bundle (desktop, Docker).
  try {
    conf = JSON.parse(fs.readFileSync(path.join(root, ".next-prod", "required-server-files.json"), "utf8")).config;
    process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(conf);
  } catch {
    console.error("[trade-ui] no production build here: run `npm run build` first, or `npm run dev`");
    process.exit(1);
  }
}
const app = next({ dev: config.dev, dir: root, hostname: config.host, port: config.port, ...(conf ? { conf } : {}) });
const handle = app.getRequestHandler();
gate = createGate({ config, auth, api, next: handle, secret: gateSecret, media });

await app.prepare();
const server = http.createServer((req, res) => {
  gate.onRequest(req, res).catch((e) => {
    console.error("[trade-ui] request failed:", e);
    if (!res.headersSent) sendError(res, 500, "internal", "Something went wrong on the server");
    else res.destroy();
  });
});
server.on("upgrade", gate.onUpgrade);
server.on("error", (e) => {
  console.error(`[trade-ui] cannot listen on ${config.host}:${config.port}: ${e.message}`);
  process.exit(1);
});
server.listen(config.port, config.host, async () => {
  const shown = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
  const local = `http://${shown.includes(":") ? `[${shown}]` : shown}:${config.port}`;
  const url = config.publicUrl || local;
  const lines = [`> trade-ui ${VERSION} on ${local}${config.dev ? " (dev)" : ""}`, `  data: ${config.dataDir}`];
  if (!config.apiKey) lines.push("  ! RAZE_API_KEY is not set: market data and swaps will be refused");
  if (!config.loopbackOnly && !config.publicUrl) {
    lines.push(`  ! listening on ${config.host}: put it behind HTTPS (see README) and set TRADE_UI_PUBLIC_URL`);
  }
  for (const [name, u] of [["RAZE_API_BASE", config.apiBase], ["RAZE_ROUTER_BASE", config.routerBase], ["RAZE_ROUTER_EVM_BASE", config.routerEvmBase]]) {
    const h = new URL(u).hostname;
    if (u.startsWith("http:") && h !== "localhost" && h !== "127.0.0.1" && h !== "::1" && !h.startsWith("10.")) {
      lines.push(`  ! ${name} is plain http on a remote host: the API key would cross the network readable`);
    }
  }
  if (!(await vault.initialized())) {
    lines.push("", "  First run: choose your password at", `    ${url}/?setup=${config.setupToken}`, `  (setup code: ${config.setupToken})`, "");
  }
  console.log(lines.join("\n"));
});

function shutdown() {
  auth.lock("shutdown");
  server.close();
  setTimeout(() => process.exit(0), 500).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
