/**
 * Configuration, from the environment only. The Raze API key lives here and
 * never reaches the browser.
 *
 * Files, filling only variables the environment does not already set, first
 * one wins: `$TRADE_UI_ENV_FILE` (the desktop app's config file), then
 * `.env.local` and `.env` next to the server (Next.js's order).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { EVM_CHAINS } from "./evm.mjs";

/** Parse `KEY=value` lines (comments, blank lines and optional quotes). */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim().replace(/^export\s+/, "");
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

export function loadEnvFile(file, env = process.env) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  for (const [k, v] of Object.entries(parseEnv(text))) {
    if (env[k] == null || env[k] === "") env[k] = v;
  }
  return true;
}

function httpUrl(raw, fallback, name) {
  const s = String(raw || "").trim().replace(/\/+$/, "") || fallback;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
  } catch {
    throw new Error(`${name} must be an http(s) URL, got "${s}"`);
  }
  return s;
}

function isLoopback(host) {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/**
 * @param {{ root: string, argv?: string[], env?: NodeJS.ProcessEnv }} opts
 */
export function loadConfig({ root, argv = process.argv, env = process.env }) {
  if (env.TRADE_UI_ENV_FILE) loadEnvFile(env.TRADE_UI_ENV_FILE, env);
  loadEnvFile(path.join(root, ".env.local"), env);
  loadEnvFile(path.join(root, ".env"), env);

  const dev = argv.includes("--dev");
  const host = String(env.HOST || "127.0.0.1").trim();
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`PORT must be a port number, got "${env.PORT}"`);

  const apiBase = httpUrl(env.RAZE_API_BASE, "https://api.raze.bot", "RAZE_API_BASE");
  const routerBase = httpUrl(env.RAZE_ROUTER_BASE, "https://router.raze.bot", "RAZE_ROUTER_BASE");
  const rpcUrl = httpUrl(env.SOLANA_RPC_URL, "https://api.mainnet-beta.solana.com", "SOLANA_RPC_URL");
  const rpcWsUrl = String(env.SOLANA_WS_URL || "").trim() || rpcUrl.replace(/^http/, "ws");
  // The RPC the launch router reads the chain through, from Raze's server:
  // it must be reachable from there (and it sees this URL).
  const launchRpcUrl = httpUrl(env.LAUNCH_RPC_URL, rpcUrl, "LAUNCH_RPC_URL");
  const routerEvmBase = httpUrl(env.RAZE_ROUTER_EVM_BASE, "https://router.raze.bot/evm", "RAZE_ROUTER_EVM_BASE");
  // One RPC per EVM chain (EVM_RPC_URL_ETH, _BSC, _BASE, _ROBINHOOD), and a
  // WebSocket for new blocks (EVM_WS_URL_*): by default your RPC's own with
  // ws(s)://, or, without one, the free endpoints of server/evm.mjs.
  const evmRpc = {};
  for (const [chain, c] of Object.entries(EVM_CHAINS)) {
    const name = chain.toUpperCase();
    const own = String(env[`EVM_RPC_URL_${name}`] || "").trim();
    const http = httpUrl(own, c.rpc, `EVM_RPC_URL_${name}`);
    const ws = String(env[`EVM_WS_URL_${name}`] || "").trim() || (own ? http.replace(/^http/, "ws") : c.ws);
    evmRpc[chain] = { http, ws };
  }

  const publicUrl = String(env.TRADE_UI_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  const allowedHosts = new Set(
    String(env.TRADE_UI_ALLOWED_HOSTS || "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
  if (publicUrl) {
    try {
      allowedHosts.add(new URL(publicUrl).host.toLowerCase());
    } catch {
      throw new Error(`TRADE_UI_PUBLIC_URL must be a URL, got "${publicUrl}"`);
    }
  }

  const priorityMax = Number(env.SWAP_PRIORITY_MAX_LAMPORTS || 500_000);
  const slipCap = Number(env.SWAP_MAX_SLIPPAGE_BPS || 5000);

  return {
    dev,
    host,
    port,
    apiBase,
    apiKey: String(env.RAZE_API_KEY || "").trim(),
    routerBase,
    rpcUrl,
    rpcWsUrl,
    launchRpcUrl,
    routerEvmBase,
    evmRpc,
    priorityMaxLamports: Number.isFinite(priorityMax) && priorityMax >= 0 ? Math.floor(priorityMax) : 500_000,
    allowSplit: env.SWAP_ALLOW_SPLIT === "1",
    maxSlippageBps: Number.isInteger(slipCap) && slipCap >= 0 && slipCap <= 10_000 ? slipCap : 5000,
    dataDir: path.resolve(root, String(env.TRADE_UI_DATA_DIR || "").trim() || "data"),
    publicUrl,
    allowedHosts,
    loopbackOnly: isLoopback(host),
    setupToken: String(env.TRADE_UI_SETUP_TOKEN || "").trim() || crypto.randomBytes(12).toString("base64url"),
    desktop: env.TRADE_UI_DESKTOP === "1",
  };
}

/**
 * Whether a request's Host header may reach this server. DNS rebinding — a
 * web page pointing a name of its own at this server — always arrives with a
 * host NAME, so: `localhost`, any IP literal, and the names configured with
 * TRADE_UI_PUBLIC_URL / TRADE_UI_ALLOWED_HOSTS; every other name is refused.
 */
export function hostAllowed(config, hostHeader) {
  const h = String(hostHeader || "").trim().toLowerCase();
  if (!h) return false;
  const bracketed = h.startsWith("[");
  const name = bracketed ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0];
  if (name === "localhost") return true;
  if (net.isIP(bracketed ? name.slice(1, -1) : name)) return true;
  return config.allowedHosts.has(h) || config.allowedHosts.has(name);
}
