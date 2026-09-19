import { readApiSettings } from "./settings";

export type Envelope<T> = {
  ok: boolean;
  data: T | null;
  error: { code?: string; message?: string } | null;
  nextCursor: string | null;
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
  if (!json) {
    throw new EvmapiError(res.status, `HTTP ${res.status}`, "bad_json");
  }
  if (!json.ok || json.data == null) {
    throw new EvmapiError(
      res.status,
      json.error?.message || `HTTP ${res.status}`,
      json.error?.code,
    );
  }
  return { data: json.data, nextCursor: json.nextCursor, status: res.status };
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
  const rel = path.startsWith("/") ? path : `/${path}`;
  return `/api/raze${rel}`;
}
