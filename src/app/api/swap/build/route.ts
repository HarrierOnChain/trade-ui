import { NextRequest } from "next/server";
import { assembleV0, type RouterBuild } from "../../../../lib/swap/v0";
import { swapBody } from "../../../../lib/swap/validate";
import { fail, fetchUp, priorityMaxLamports, relayRouter, routerBase } from "../../../../lib/swap/upstream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST {wallet, quote, priorityFeeLamports?, v0?} → router `POST
 * /swap-instructions` with the quote as shown (`quoteResponse`, serialized).
 * Answers the unsigned v1 transaction, and with `v0` the same instructions
 * re-assembled as v0 for a browser wallet that cannot sign v1.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 64 * 1024) return fail(413, "bad_request", "body too large");
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return fail(400, "bad_request", "body is not JSON");
  }
  const parsed = swapBody(input, { priorityMaxLamports: priorityMaxLamports() });
  if (parsed.error !== undefined) return fail(400, "bad_request", parsed.error);
  const { body, v0 } = parsed;

  const r = await fetchUp(`${routerBase()}/swap-instructions`, { method: "POST", body, timeout: 15_000 });
  if (r.status !== 200) return relayRouter(r);
  let build: RouterBuild & {
    quoteId?: string;
    inAmount?: string;
    outAmount?: string;
    otherAmountThreshold?: string;
  };
  try {
    build = JSON.parse(r.text);
  } catch {
    return fail(502, "upstream_unavailable", "router answered an unreadable build");
  }
  if (typeof build.swapTransaction !== "string") {
    return fail(502, "upstream_unavailable", "router build has no transaction");
  }

  let transactionV0: string | null = null;
  let v0Unavailable: string | null = null;
  if (v0) {
    try {
      const out = assembleV0(build, body.userPublicKey);
      transactionV0 = out.transaction;
      v0Unavailable = out.transaction ? null : (out.reason ?? null);
    } catch (e) {
      return fail(502, "upstream_unavailable", e instanceof Error ? e.message : String(e));
    }
  }
  return Response.json(
    {
      data: {
        transaction: build.swapTransaction,
        transactionV0,
        v0Unavailable,
        lastValidBlockHeight: build.lastValidBlockHeight ?? null,
        quoteId: build.quoteId ?? null,
        inAmount: build.inAmount ?? null,
        outAmount: build.outAmount ?? null,
        otherAmountThreshold: build.otherAmountThreshold ?? null,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
