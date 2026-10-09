/**
 * WebSocket proxies: the browser opens a same-origin socket, this server opens
 * the upstream one and splices the two. Credentials are added on this side.
 */
import http from "node:http";
import https from "node:https";

export function rejectUpgrade(socket, status, message) {
  try {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch { /* ignore */ }
  try { socket.destroy(); } catch { /* ignore */ }
}

// Headers that describe the browser's hop, not the upstream request.
const DROP = new Set([
  "host", "cookie", "origin", "authorization", "x-api-key",
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "content-length",
]);

function forwardHeaders(req) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value == null || DROP.has(name.toLowerCase())) continue;
    headers[name] = value;
  }
  return headers;
}

/**
 * Open the upstream WebSocket and splice the two hops together. `track`
 * receives the upstream socket once the upgrade succeeded (so a lock can
 * close it); `allowed` is asked again at that moment.
 */
function connectUpgrade(socket, head, { secure, hostname, port, path, headers }, track, allowed = () => true) {
  const upstream = (secure ? https : http).request({
    protocol: secure ? "https:" : "http:",
    hostname,
    port: port || (secure ? 443 : 80),
    path,
    method: "GET",
    headers,
    servername: secure ? hostname : undefined,
    timeout: 10_000,
  });

  let settled = false;
  const fail = (status, message) => {
    if (settled) return;
    settled = true;
    rejectUpgrade(socket, status, message);
  };
  socket.on("error", () => { try { upstream.destroy(); } catch { /* ignore */ } });
  // The browser's hop closed (or a lock closed it) before the upstream answered.
  socket.once("close", () => { if (!settled) { settled = true; try { upstream.destroy(); } catch { /* ignore */ } } });
  upstream.on("timeout", () => {
    upstream.destroy();
    fail(504, "Gateway Timeout");
  });
  upstream.on("error", () => fail(502, "Bad Gateway"));
  // Not a 101: the upstream refused (401 without a valid key, 429, …). Relay
  // the status so the browser's socket fails fast and the client falls back.
  upstream.on("response", (res) => {
    res.resume();
    fail(res.statusCode || 502, res.statusMessage || "Bad Gateway");
  });
  upstream.on("upgrade", (res, upSocket, upHead) => {
    if (settled || socket.destroyed || !allowed()) {
      settled = true;
      upSocket.destroy();
      try { socket.destroy(); } catch { /* ignore */ }
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
    track?.(upSocket);
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

/** `/api/ws` → `${apiBase}/ws`: subscriptions in the query kept, the key added. */
export function proxyApiWs(config, req, socket, head, track, allowed) {
  let base;
  try {
    base = new URL(config.apiBase);
  } catch {
    rejectUpgrade(socket, 502, "Bad Gateway");
    return;
  }
  const params = new URLSearchParams();
  try {
    new URL(req.url || "/", "http://local").searchParams.forEach((v, k) => {
      if (k !== "api_key" && k !== "apiKey") params.set(k, v);
    });
  } catch { /* ignore */ }
  const qs = params.toString();
  const headers = forwardHeaders(req);
  headers.host = base.host;
  if (config.apiKey) headers["x-api-key"] = config.apiKey;
  connectUpgrade(socket, head, {
    secure: base.protocol === "https:",
    hostname: base.hostname,
    port: base.port,
    path: `${base.pathname.replace(/\/+$/, "")}/ws${qs ? `?${qs}` : ""}`,
    headers,
  }, track, allowed);
}

/** `/api/solana/ws` → the RPC's WebSocket; its URL, and any key in it, stays here. */
export function proxySolanaWs(config, req, socket, head, track, allowed) {
  let target;
  try {
    target = new URL(config.rpcWsUrl);
  } catch {
    rejectUpgrade(socket, 502, "Bad Gateway");
    return;
  }
  const headers = forwardHeaders(req);
  headers.host = target.host;
  connectUpgrade(socket, head, {
    secure: target.protocol === "wss:" || target.protocol === "https:",
    hostname: target.hostname,
    port: target.port,
    path: `${target.pathname || "/"}${target.search}`,
    headers,
  }, track, allowed);
}
