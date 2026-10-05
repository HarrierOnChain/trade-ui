import { NextRequest } from "next/server";
import { rpcRequest } from "../../../../lib/swap/validate";
import { fail, rpcUrl } from "../../../../lib/swap/upstream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** → SOLANA_RPC_URL, one JSON-RPC call at a time and only the methods a swap
 *  needs (send, confirm, the balance and decimals reads). The RPC URL, and any
 *  key in it, stays on this side. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 32 * 1024) return fail(413, "bad_request", "body too large");
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return fail(400, "bad_request", "body is not JSON");
  }
  const call = rpcRequest(input);
  if ("error" in call && call.error !== undefined) return fail(400, "bad_request", call.error);
  const { method, params } = call as { method: string; params: unknown[] };
  let upstream: Response;
  try {
    upstream = await fetch(rpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return fail(502, "upstream_unavailable", "RPC unreachable");
  }
  const text = await upstream.text();
  try {
    JSON.parse(text);
  } catch {
    return fail(502, "upstream_unavailable", `RPC answered ${upstream.status}`);
  }
  return new Response(text, {
    status: upstream.ok ? 200 : upstream.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
