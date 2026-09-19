import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE_KEY = "trade_ui_api_key";
const COOKIE_BASE = "trade_ui_api_base";
const DEFAULT_BASE = process.env.RAZE_API_BASE || "https://api.raze.bot";

function wsUrlFor(base: string, key: string): string {
  const u = new URL((base || "http://127.0.0.1:8810").replace(/\/+$/, ""));
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws";
  u.search = "";
  if (key) u.searchParams.set("api_key", key);
  return u.toString();
}

export async function GET() {
  const jar = await cookies();
  const envKey = (process.env.RAZE_API_KEY || "").trim();
  const envBase = (process.env.RAZE_API_BASE || "").replace(/\/+$/, "");
  const cookieKey = jar.get(COOKIE_KEY)?.value || "";
  const cookieBase = (jar.get(COOKIE_BASE)?.value || "").replace(/\/+$/, "");
  const key = envKey || cookieKey;
  const base = envBase || cookieBase || DEFAULT_BASE.replace(/\/+$/, "");
  return NextResponse.json({
    configured: Boolean(key),
    apiBase: base,
    hasEnvKey: Boolean(envKey),
    wsUrl: key ? wsUrlFor(base, key) : null,
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
