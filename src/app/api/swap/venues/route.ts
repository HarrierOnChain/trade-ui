import { fail, fetchUp, relayRouter, routerBase } from "../../../../lib/swap/upstream";
import { gateClosed } from "../../../../lib/server/gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let cache: { at: number; body: string | null } = { at: 0, body: null };

/** → router `GET /venues`: the venues it can both serve and build, with the
 *  price oracle's verdict. Cached for a minute. */
export async function GET(req: Request) {
  const closed = gateClosed(req);
  if (closed) return closed;
  if (cache.body && Date.now() - cache.at < 60_000) {
    return new Response(cache.body, { headers: { "content-type": "application/json" } });
  }
  const r = await fetchUp(`${routerBase()}/venues`, { timeout: 10_000 });
  if (r.status !== 200) return relayRouter(r);
  let venues: unknown;
  try {
    venues = (JSON.parse(r.text) as { venues?: unknown }).venues;
  } catch {
    return fail(502, "upstream_unavailable", "router answered an unreadable venue table");
  }
  type Row = { dex?: unknown; buildable?: unknown; servable?: unknown; oracle?: { verdict?: unknown } };
  const data = (Array.isArray(venues) ? (venues as Row[]) : [])
    .filter((v) => v && v.buildable && v.servable && typeof v.dex === "string")
    .map((v) => ({ dex: v.dex as string, verdict: typeof v.oracle?.verdict === "string" ? v.oracle.verdict : null }));
  cache = { at: Date.now(), body: JSON.stringify({ data }) };
  return new Response(cache.body, { headers: { "content-type": "application/json" } });
}
