import { readApiSettings } from "./settings";

/**
 * The API's envelope: `{"data": …}` on success (plus `"next"` on paged lists),
 * `{"error": {"code", "message"}}` with an HTTP status on failure.
 */
export type Envelope<T> = {
  data?: T | null;
  next?: string | null;
  error?: { code?: string; message?: string } | null;
};

export class EvmapiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * GET a `/v1` route through the same-origin proxy (`/api/raze/*`, which adds
 * the `/v1` prefix and the key). `path` is the route without `/v1`, e.g.
 * `/tokens/sol/<mint>`. `nextCursor` is the page's `next`, to pass back as
 * `cursor`.
 */
export async function evmapiGet<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
  { timeout = 25_000 } = {},
): Promise<{ data: T; nextCursor: string | null; status: number }> {
  const url = new URL(path.startsWith("http") ? path : `/api/raze${path.startsWith("/") ? path : `/${path}`}`,
    typeof window === "undefined" ? "http://127.0.0.1" : window.location.origin);
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { accept: "application/json" };
  const { apiKey, apiBase } = readApiSettings();
  if (apiKey) headers["x-trade-ui-key"] = apiKey;
  // Only forward an explicit Settings override. The hardcoded raze.bot
  // default must not override RAZE_API_BASE from .env.local.
  if (apiBase && apiBase !== "https://api.raze.bot") headers["x-trade-ui-base"] = apiBase;

  let res: Response;
  try {
    res = await fetch(url.pathname + url.search, {
      headers,
      signal: AbortSignal.timeout(timeout),
      cache: "no-store",
    });
  } catch (e) {
    const timedOut =
      e instanceof Error && (e.name === "TimeoutError" || /timed out/i.test(e.message));
    throw new EvmapiError(
      timedOut ? 504 : 502,
      timedOut ? "Upstream timed out" : (e instanceof Error ? e.message : "fetch failed"),
      timedOut ? "upstream_timeout" : "upstream_error",
    );
  }
  const json = await res.json().catch(() => null) as Envelope<T> | null;
  if (!json || typeof json !== "object") {
    throw new EvmapiError(res.status, `HTTP ${res.status}`, "bad_json");
  }
  if (!res.ok || json.error) {
    throw new EvmapiError(
      res.status,
      json.error?.message || `HTTP ${res.status}`,
      json.error?.code,
    );
  }
  if (json.data == null) {
    throw new EvmapiError(404, "Not found", "not_found");
  }
  return { data: json.data, nextCursor: json.next ?? null, status: res.status };
}

export function imageSrc(path: string | null | undefined): string | null {
  if (!path) return null;
  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:") ||
    path.startsWith("ipfs://")
  ) {
    return path;
  }
  // Already rewritten (REST + WS both flow through here).
  if (path.startsWith("/api/raze/") || path === "/api/raze") return path;
  // A relative API path (`/v1/tokens/…/image` or `/tokens/…/image`): the proxy
  // adds `/v1` itself.
  const rel = (path.startsWith("/") ? path : `/${path}`).replace(/^\/v1(?=\/)/, "");
  return `/api/raze${rel}`;
}

/** Same-origin URL of the API's image redirect for a token (302 → the image). */
export function tokenImagePath(chain: string, address: string): string {
  return `/api/raze/tokens/${encodeURIComponent(chain)}/${encodeURIComponent(address)}/image`;
}
