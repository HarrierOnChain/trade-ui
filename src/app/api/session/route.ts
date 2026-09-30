import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const COOKIE_KEY = "trade_ui_api_key";
const COOKIE_BASE = "trade_ui_api_base";
const DEFAULT_BASE = process.env.RAZE_API_BASE || "https://api.raze.bot";

/**
 * The API's WebSocket, WITHOUT a key: the browser only ever gets a key it
 * typed itself (Settings), never the server's. `null` when the base is not a
 * usable URL.
 */
function directWsUrl(base: string): string | null {
  try {
    const u = new URL(base.replace(/\/+$/, ""));
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = `${u.pathname.replace(/\/+$/, "")}/v1/ws`;
    u.search = "";
    return u.toString();
  } catch {
    return null;
  }
}

// An API with no keys configured is open. Probe once in a while so a keyless
// local API does not park the UI on the key prompt.
const openProbe = new Map<string, { at: number; open: boolean }>();

async function isOpenApi(base: string): Promise<boolean> {
  const hit = openProbe.get(base);
  if (hit && Date.now() - hit.at < 30_000) return hit.open;
  let open = false;
  try {
    const r = await fetch(`${base}/v1/chains`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    open = r.ok;
  } catch {
    open = false;
  }
  openProbe.set(base, { at: Date.now(), open });
  return open;
}

export async function GET() {
  const jar = await cookies();
  const envKey = (process.env.RAZE_API_KEY || "").trim();
  const envBase = (process.env.RAZE_API_BASE || "").replace(/\/+$/, "");
  const cookieKey = jar.get(COOKIE_KEY)?.value || "";
  const cookieBase = (jar.get(COOKIE_BASE)?.value || "").replace(/\/+$/, "");
  const key = envKey || cookieKey;
  const base = envBase || cookieBase || DEFAULT_BASE.replace(/\/+$/, "");
  const open = key ? false : await isOpenApi(base);
  return NextResponse.json({
    configured: Boolean(key) || open,
    apiBase: base,
    hasEnvKey: Boolean(envKey),
    // server.cjs upgrades same-origin `/api/ws` and adds the key server-side.
    wsProxy: process.env.TRADE_UI_WS_PROXY === "1",
    // Direct socket for `next dev` (no upgrade handler there). Keyless: it
    // works against an open API, or with the key the user typed in Settings.
    wsUrl: directWsUrl(base),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { apiKey?: string; apiBase?: string };
  const apiKey = String(body.apiKey || "").trim();
  const apiBase = String(body.apiBase || DEFAULT_BASE).replace(/\/+$/, "") || DEFAULT_BASE;
  const res = NextResponse.json({ ok: true, configured: Boolean(apiKey || process.env.RAZE_API_KEY) });
  const secure = process.env.NODE_ENV === "production";
  if (apiKey) {
    res.cookies.set(COOKIE_KEY, apiKey, { httpOnly: true, sameSite: "lax", path: "/", secure });
  } else {
    res.cookies.set(COOKIE_KEY, "", { httpOnly: true, sameSite: "lax", path: "/", secure, maxAge: 0 });
  }
  res.cookies.set(COOKIE_BASE, apiBase, { httpOnly: true, sameSite: "lax", path: "/", secure });
  return res;
}
