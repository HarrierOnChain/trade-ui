/**
 * Route handlers answer only requests that came through server.mjs's gate,
 * which checks the session and then sets a per-boot secret header (dropping
 * any copy a client sent). Reached any other way — plain `next dev` /
 * `next start`, or a path the gate did not see as `/api/` — they refuse.
 */
const GATE_HEADER = "x-trade-ui-gate";

export function gateClosed(req: Request): Response | null {
  const secret = (globalThis as Record<symbol, unknown>)[Symbol.for("trade-ui.gate")];
  if (typeof secret === "string" && secret.length >= 32 && req.headers.get(GATE_HEADER) === secret) return null;
  return Response.json(
    {
      error: {
        code: "no_gate",
        message: "Start Trade UI with `npm run dev` or `npm start` (server.mjs), not with `next` directly",
      },
    },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}
