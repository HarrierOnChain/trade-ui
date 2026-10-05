/**
 * Server side: where the swap routes go. Read per request, so `.env.local`
 * (loaded by server.cjs) and a restart are all it takes to change them.
 *
 *   RAZE_ROUTER_BASE            the Solana router (keyless): quotes, venues, builds.
 *                               Default https://router.raze.bot.
 *   SOLANA_RPC_URL              the RPC that sends and confirms the signed swap and
 *                               answers balance reads. It must accept v1
 *                               transactions (Agave with SIMD-0385; mainnet-beta's
 *                               public RPC does). Default https://api.mainnet-beta.solana.com.
 *   SOLANA_WS_URL               its WebSocket (signatureSubscribe); default: the RPC
 *                               URL with ws(s)://.
 *   SWAP_PRIORITY_MAX_LAMPORTS  cap of the router's own priority-fee estimate when
 *                               the trader sets none (default 500,000).
 *   SWAP_ALLOW_SPLIT            "1": quotes may split across two routes.
 */

const trim = (s: string) => s.trim().replace(/\/+$/, "");

export function routerBase(): string {
  return trim(process.env.RAZE_ROUTER_BASE || "") || "https://router.raze.bot";
}

export function rpcUrl(): string {
  return (process.env.SOLANA_RPC_URL || "").trim() || "https://api.mainnet-beta.solana.com";
}

export function priorityMaxLamports(): number {
  const n = Number(process.env.SWAP_PRIORITY_MAX_LAMPORTS || 500_000);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 500_000;
}

export function allowSplit(): boolean {
  return process.env.SWAP_ALLOW_SPLIT === "1";
}

export interface Upstream {
  status: number;
  text: string;
}

/** One upstream call; status 0 when it could not be made or timed out. */
export async function fetchUp(
  url: string,
  init: { method?: string; body?: unknown; timeout?: number } = {},
): Promise<Upstream> {
  try {
    const r = await fetch(url, {
      method: init.method || "GET",
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
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
  if (!isJson(r.text)) {
    return fail(r.status >= 400 ? r.status : 502, "upstream_unavailable", `router answered ${r.status}`);
  }
  return new Response(r.text, {
    status: r.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
