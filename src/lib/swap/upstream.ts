/**
 * Server side: where the venue list and the RPC reads go. Read per request
 * from the server's environment (server.mjs loads `.env`). Quotes and builds
 * are server.mjs's own (server/quotes.mjs, server/solana.mjs).
 *
 *   RAZE_ROUTER_BASE            the Solana router. Default https://router.raze.bot,
 *                               which wants the API key (RAZE_API_KEY) like the API.
 *   SOLANA_RPC_URL              the RPC that answers balance and status reads. Default
 *                               https://api.mainnet-beta.solana.com.
 */

const trim = (s: string) => s.trim().replace(/\/+$/, "");

export function routerBase(): string {
  return trim(process.env.RAZE_ROUTER_BASE || "") || "https://router.raze.bot";
}

export function rpcUrl(): string {
  return (process.env.SOLANA_RPC_URL || "").trim() || "https://api.mainnet-beta.solana.com";
}

export interface Upstream {
  status: number;
  text: string;
}

/** The router's headers: the API key, which router.raze.bot checks like the API. */
function routerHeaders(json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  const key = (process.env.RAZE_API_KEY || "").trim();
  if (key) h["x-api-key"] = key;
  if (json) h["content-type"] = "application/json";
  return h;
}

/** One router call; status 0 when it could not be made or timed out. */
export async function fetchUp(
  url: string,
  init: { method?: string; body?: unknown; timeout?: number } = {},
): Promise<Upstream> {
  try {
    const r = await fetch(url, {
      method: init.method || "GET",
      headers: routerHeaders(init.body !== undefined),
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      // A redirect would carry the API key elsewhere.
      redirect: "error",
      signal: AbortSignal.timeout(init.timeout ?? 10_000),
    });
    return { status: r.status, text: await r.text() };
  } catch {
    return { status: 0, text: "" };
  }
}

export function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function fail(status: number, error: string, reason: string): Response {
  return Response.json({ error, reason }, { status, headers: { "cache-control": "no-store" } });
}

/** A router answer passed through as is when it is JSON; anything else wrapped. */
export function relayRouter(r: Upstream): Response {
  if (r.status === 0) return fail(502, "upstream_unavailable", "router unreachable");
  if (r.status === 401 || r.status === 403) {
    return fail(502, "upstream_unauthorized", "the router refused the API key: check RAZE_API_KEY");
  }
  if (!isJson(r.text)) {
    return fail(r.status >= 400 ? r.status : 502, "upstream_unavailable", `router answered ${r.status}`);
  }
  return new Response(r.text, {
    status: r.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
