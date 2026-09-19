/**
 * Map a data-fetch error to a user-facing string.
 *
 * Known transient wire/upstream failures translate into an honest notice;
 * every other error keeps its real message so genuine failures stay
 * debuggable.
 */
const UPSTREAM_TIMEOUT_RE =
  /^(upstream_timeout|raze\.get_timeout|wire_closed)$/i;
const ABORT_MSG_RE = /abort|timed out|TimeoutError/i;

export function friendlyFetchError(e: unknown): string {
  const code =
    e && typeof e === "object" && "code" in e
      ? String((e as { code?: unknown }).code ?? "")
      : "";
  const msg = e instanceof Error ? e.message : String(e);
  if (
    code === "upstream_timeout" ||
    UPSTREAM_TIMEOUT_RE.test(msg) ||
    ABORT_MSG_RE.test(msg) ||
    /^upstream_50[234]$/i.test(code)
  ) {
    return "Regional data proxy timed out — retry or switch region";
  }
  if (code === "wire_closed") {
    return "Connection to regional backend lost — retrying…";
  }
  return msg;
}
