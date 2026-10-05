import { NextRequest } from "next/server";
import { quoteQuery } from "../../../../lib/swap/validate";
import { allowSplit, fail, fetchUp, relayRouter, routerBase } from "../../../../lib/swap/upstream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** → router `GET /quote`, whitelisted parameters only. */
export async function GET(req: NextRequest) {
  const { query, error } = quoteQuery(req.nextUrl.searchParams, { allowSplit: allowSplit() });
  if (error !== undefined) return fail(400, "bad_request", error);
  return relayRouter(await fetchUp(`${routerBase()}/quote?${query}`, { timeout: 10_000 }));
}
