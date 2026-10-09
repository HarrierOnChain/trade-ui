/**
 * What every request and WebSocket goes through before Next.js:
 *
 *   - Host: only the names this server is meant to answer (DNS rebinding).
 *   - Writes under `/api/` carry `x-trade-ui: 1` and, if sent, a same-site
 *     Origin (a page on another site cannot add that header without a CORS
 *     preflight, which nothing here answers).
 *   - `/api/*`: the routes of server/api.mjs, then a session for the rest,
 *     which reaches Next.js with the gate's secret header (the route handlers
 *     check it; any copy sent by a client is dropped first).
 *   - `/api/ws`, `/api/solana/ws`: a session, then the proxies.
 *   - A lock ends every stream and socket a session opened, finished or not.
 */
import { hostAllowed } from "./config.mjs";
import { sendError } from "./api.mjs";
import { proxyApiWs, proxySolanaWs, rejectUpgrade } from "./ws-proxy.mjs";

/** Set on requests that passed the gate; Next's route handlers require it. */
export const GATE_HEADER = "x-trade-ui-gate";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The Origin header, when present, must be this site. */
export function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host.toLowerCase() === String(req.headers.host || "").toLowerCase();
  } catch {
    return false;
  }
}

function refuseHost(res) {
  res.writeHead(403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(
    "Trade UI does not answer for this host name.\n"
    + "Behind a reverse proxy or a domain, set TRADE_UI_PUBLIC_URL (e.g. https://trade.example.com)"
    + " or TRADE_UI_ALLOWED_HOSTS and restart.\n",
  );
}

/**
 * @param {{
 *   config: any,
 *   auth: import("./auth.mjs").Auth,
 *   api: (req: any, res: any, pathname: string) => Promise<boolean>,
 *   next: (req: any, res: any) => unknown,
 *   secret: string,
 * }} deps
 */
export function createGate({ config, auth, api, next, secret }) {
  /** Sockets and responses a session holds open, ended when the vault locks. */
  const live = new Set();
  const track = (...items) => {
    for (const s of items) {
      live.add(s);
      s.once("close", () => live.delete(s));
    }
  };
  const hsts = config.publicUrl.startsWith("https:");

  async function onRequest(req, res) {
    let pathname;
    try {
      pathname = new URL(req.url || "/", "http://local").pathname;
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (!hostAllowed(config, req.headers.host)) return refuseHost(res);
    if (hsts) res.setHeader("strict-transport-security", "max-age=31536000");
    delete req.headers[GATE_HEADER];

    if (pathname.startsWith("/api/")) {
      if (!SAFE_METHODS.has(req.method || "GET") && (req.headers["x-trade-ui"] !== "1" || !originOk(req))) {
        return sendError(res, 403, "forbidden", "Cross-site request refused");
      }
      // Streams and long requests of a session end with the lock; the lock's
      // own routes answer, then close normally.
      if (!pathname.startsWith("/api/auth/")) track(res);
      if (await api(req, res, pathname)) return;
      if (!auth.sessionOf(req)) return sendError(res, 401, "locked", "Locked: enter your password");
      req.headers[GATE_HEADER] = secret;
    }
    return next(req, res);
  }

  function onUpgrade(req, socket, head) {
    const pathname = String(req.url || "").split("?")[0];
    if (pathname === "/api/ws" || pathname === "/api/solana/ws") {
      if (!hostAllowed(config, req.headers.host) || !originOk(req)) return rejectUpgrade(socket, 403, "Forbidden");
      const token = auth.sessionOf(req);
      if (!token) return rejectUpgrade(socket, 401, "Unauthorized");
      // Tracked from now, not from the upstream's answer: a lock during the
      // handshake ends it too, and the session is checked again at the 101.
      track(socket);
      const allowed = () => auth.sessionOf(req) === token;
      if (pathname === "/api/ws") proxyApiWs(config, req, socket, head, track, allowed);
      else proxySolanaWs(config, req, socket, head, track, allowed);
      return;
    }
    // In dev Next adds its own upgrade listener for hot reload (/_next/webpack-hmr).
    if (!config.dev) socket.destroy();
  }

  function closeSockets() {
    for (const s of live) {
      try { s.destroy(); } catch { /* ignore */ }
    }
    live.clear();
  }

  return { onRequest, onUpgrade, closeSockets };
}
