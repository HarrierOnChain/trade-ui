import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_BASE = (process.env.RAZE_API_BASE || "https://api.raze.bot").replace(/\/+$/, "");

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

async function credentials(req: NextRequest): Promise<{ base: string; key: string }> {
  const jar = await cookies();
  const envKey = (process.env.RAZE_API_KEY || "").trim();
  const envBase = (process.env.RAZE_API_BASE || "").replace(/\/+$/, "");
  const headerKey = req.headers.get("x-trade-ui-key") || req.headers.get("x-api-key") || "";
  // .env.local wins. Browser localStorage still defaults to api.raze.bot and
  // would otherwise override a local evmapi via x-trade-ui-base.
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
  const segs = params.path || [];
  const path = segs.map(encodeURIComponent).join("/");
  const { base, key } = await credentials(req);
  if (!key) {
    return NextResponse.json(
      { ok: false, data: null, error: { code: "unauthorized", message: "Set RAZE_API_KEY or paste a key in Settings." }, nextCursor: null },
      { status: 401 },
    );
  }
  const url = new URL(`${base}/${path}`);
  req.nextUrl.searchParams.forEach((value, k) => {
    if (k === "api_key") return;
    url.searchParams.set(k, value);
  });

  const headers = new Headers();
  headers.set("x-api-key", key);
  headers.set("accept", req.headers.get("accept") || "*/*");
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const isStream =
    segs[segs.length - 1] === "stream" ||
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
      {
        ok: false,
        data: null,
        error: {
          code: timedOut ? "upstream_timeout" : "upstream_error",
          message: timedOut ? "Upstream timed out" : "Upstream request failed",
        },
        nextCursor: null,
      },
      { status: timedOut ? 504 : 502 },
    );
  }
  const outHeaders = new Headers();
  const pass = ["content-type", "cache-control", "x-request-id"];
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
