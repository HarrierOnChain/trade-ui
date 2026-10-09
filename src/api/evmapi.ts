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
 * GET an API route through the same-origin proxy (`/api/raze/*`, which adds
 * the key), e.g. `/tokens/sol/<mint>`. `nextCursor` is the page's `next`, to pass back as
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
  // A relative API path (`/tokens/…/image`, or `/v1/tokens/…/image` with the
  // API's prefix until 2026-10-05, dropped here).
  const rel = (path.startsWith("/") ? path : `/${path}`).replace(/^\/v1(?=\/)/, "");
  return `/api/raze${rel}`;
}
