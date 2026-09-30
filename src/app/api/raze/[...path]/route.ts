import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** RAZE_API_BASE is the API's host root (`https://api.raze.bot`,
 *  `http://localhost:8810`); this proxy adds the `/v1` prefix. */
const DEFAULT_BASE = (process.env.RAZE_API_BASE || "https://api.raze.bot").replace(/\/+$/, "");

/** Routes the API serves outside `/v1`. */
const ROOT_ROUTES = new Set(["health"]);

function sanitizeBase(raw: string): string | null {
  const s = raw.trim().replace(/\/+$/, "");
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return s;
  } catch {
    return null;
  }
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

async function credentials(req: NextRequest): Promise<{ base: string; key: string }> {
  const jar = await cookies();
  const envKey = (process.env.RAZE_API_KEY || "").trim();
  const envBase = (process.env.RAZE_API_BASE || "").replace(/\/+$/, "");
  const headerKey = req.headers.get("x-trade-ui-key") || req.headers.get("x-api-key") || "";
  // .env.local wins. Browser localStorage still defaults to api.raze.bot and
  // would otherwise override a local API via x-trade-ui-base.
  const key = (
    envKey ||
    headerKey ||
    jar.get("trade_ui_api_key")?.value ||
    ""
  ).trim();
  const base = (
    envBase ||
    sanitizeBase(req.headers.get("x-trade-ui-base") || "") ||
    jar.get("trade_ui_api_base")?.value ||
    DEFAULT_BASE
  ).replace(/\/+$/, "");
  return { base, key };
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const params = await ctx.params;
  // `/api/raze/v1/…` and `/api/raze/…` are the same route.
  const segs = (params.path || []).filter((s, i) => !(i === 0 && s === "v1"));
  const path = segs.map(encodeURIComponent).join("/");
  const { base, key } = await credentials(req);
  // No key is fine: an API without keys configured is open. When it is not,
  // it answers 401 itself and the UI asks for a key.
  const prefix = ROOT_ROUTES.has(segs[0] || "") ? "" : "/v1";
  let url: URL;
  try {
    url = new URL(`${base}${prefix}/${path}`);
  } catch {
    return NextResponse.json(errorBody("bad_request", "Invalid API base"), { status: 400 });
  }
  req.nextUrl.searchParams.forEach((value, k) => {
    // The key travels as a header, never in a URL the upstream might log.
    if (k === "api_key" || k === "apiKey") return;
    url.searchParams.set(k, value);
  });

  const headers = new Headers();
  if (key) headers.set("x-api-key", key);
  headers.set("accept", req.headers.get("accept") || "*/*");
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  // `/v1/stream/{channel}` is the API's Server-Sent Events route.
  const isStream =
    segs[0] === "stream" ||
    (req.headers.get("accept") || "").includes("text/event-stream");

  if (isStream) return proxySse(req, url, headers);

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Buffer.from(await req.arrayBuffer());
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch (e) {
    const timedOut =
      e instanceof Error && (e.name === "TimeoutError" || /timed out/i.test(e.message));
    return NextResponse.json(
      errorBody(
        timedOut ? "upstream_timeout" : "upstream_unavailable",
        timedOut ? "Upstream timed out" : "Upstream request failed",
      ),
      { status: timedOut ? 504 : 502 },
    );
  }
  const outHeaders = new Headers();
  // `location`: the token image route answers 302 to the image itself.
  const pass = ["content-type", "cache-control", "x-request-id", "location", "retry-after"];
  for (const name of pass) {
    const v = upstream.headers.get(name);
    if (v) outHeaders.set(name, v);
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers: outHeaders });
}

const SSE_MAX = 12;
let sseLive = 0;

async function proxySse(req: NextRequest, url: URL, headers: Headers): Promise<NextResponse> {
  if (sseLive >= SSE_MAX) {
    return new NextResponse("retry: 4000\n\n", {
      status: 503,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  sseLive += 1;
  let released = false;
  const ctrl = new AbortController();
  const onClientGone = () => ctrl.abort();
  req.signal.addEventListener("abort", onClientGone, { once: true });
  const life = setTimeout(() => ctrl.abort(), 10 * 60_000);
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(life);
    req.signal.removeEventListener("abort", onClientGone);
    sseLive = Math.max(0, sseLive - 1);
  };

  headers.set("accept", "text/event-stream");
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: ctrl.signal,
    });
  } catch {
    release();
    return new NextResponse("retry: 4000\n\n", {
      status: 502,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const outHeaders = new Headers();
  outHeaders.set("content-type", upstream.headers.get("content-type") || "text/event-stream; charset=utf-8");
  outHeaders.set("cache-control", "no-store");
  outHeaders.set("connection", "keep-alive");
  outHeaders.set("x-accel-buffering", "no");

  const src = upstream.body;
  if (!src) {
    release();
    return new NextResponse(null, { status: upstream.status, headers: outHeaders });
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const reader = src.getReader();
  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) await writer.write(value);
      }
      await writer.close();
    } catch {
      try { await writer.abort(); } catch { /* ignore */ }
      try { await reader.cancel(); } catch { /* ignore */ }
      try { ctrl.abort(); } catch { /* ignore */ }
    } finally {
      release();
    }
  })();

  return new NextResponse(readable, { status: upstream.status, headers: outHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
