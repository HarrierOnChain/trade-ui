import { NextRequest, NextResponse } from "next/server";
import { gateClosed } from "../../../../lib/server/gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * `/api/raze/*` → the market-data API, with the key added here. Both come from
 * the server's environment only (RAZE_API_BASE, RAZE_API_KEY): nothing the
 * browser sends can point this proxy, or the key, anywhere else.
 */
function upstream(): { base: string; key: string } {
  return {
    base: (process.env.RAZE_API_BASE || "https://api.raze.bot").trim().replace(/\/+$/, ""),
    key: (process.env.RAZE_API_KEY || "").trim(),
  };
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

/** What may come back on this app's own origin: data and raster images. HTML,
 *  SVG or script from an upstream (bytes a token creator may control) would
 *  run as the app, so anything else is served as an inert download. */
const SAFE_TYPES = /^(application\/json|application\/problem\+json|text\/event-stream|text\/plain|image\/(png|jpe?g|gif|webp|avif|x-icon|vnd\.microsoft\.icon))\b/i;

function safeHeaders(contentType: string | null): Headers {
  const h = new Headers();
  if (contentType && SAFE_TYPES.test(contentType)) h.set("content-type", contentType);
  else {
    h.set("content-type", "application/octet-stream");
    h.set("content-disposition", "attachment");
  }
  h.set("x-content-type-options", "nosniff");
  h.set("content-security-policy", "default-src 'none'; sandbox");
  return h;
}

const MAX_BODY = 1024 * 1024;

async function proxy(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const closed = gateClosed(req);
  if (closed) return closed;
  const params = await ctx.params;
  // The API still answers its old `/v1` prefix itself.
  const segs = params.path || [];
  const path = segs.map(encodeURIComponent).join("/");
  const { base, key } = upstream();
  let url: URL;
  try {
    url = new URL(`${base}/${path}`);
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

  // `/stream/{channel}` is the API's Server-Sent Events route.
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
    if (Number(req.headers.get("content-length") || 0) > MAX_BODY) {
      return NextResponse.json(errorBody("bad_request", "Body too large"), { status: 413 });
    }
    const body = Buffer.from(await req.arrayBuffer());
    if (body.length > MAX_BODY) return NextResponse.json(errorBody("bad_request", "Body too large"), { status: 413 });
    init.body = body;
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(url, init);
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
  const outHeaders = safeHeaders(upstreamRes.headers.get("content-type"));
  // `location`: the token image route answers 302 to the image itself, which
  // the browser then loads from its own origin.
  const pass = ["cache-control", "x-request-id", "location", "retry-after"];
  for (const name of pass) {
    const v = upstreamRes.headers.get(name);
    if (v) outHeaders.set(name, v);
  }
  return new NextResponse(upstreamRes.body, { status: upstreamRes.status, headers: outHeaders });
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
  outHeaders.set("content-type", "text/event-stream; charset=utf-8");
  outHeaders.set("x-content-type-options", "nosniff");
  outHeaders.set("content-security-policy", "default-src 'none'; sandbox");
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
