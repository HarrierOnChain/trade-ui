/**
 * What the `/api/solana/rpc` route forwards. Pure, so the tests exercise it
 * directly. (Quotes and builds are the server's: server/quotes.mjs and
 * server/solana.mjs.)
 */

/** JSON-RPC methods `/api/solana/rpc` forwards: the confirmation fallback and
 *  the reads a trade needs (exact token balances, decimals). Sending is the
 *  server's own job (server/solana.mjs). */
export const RPC_METHODS = new Set([
  "getSignatureStatuses",
  "getBalance",
  "getTokenAccountsByOwner",
  "getAccountInfo",
]);

/** A single JSON-RPC request whose method is whitelisted. */
export function rpcRequest(input: unknown): { method: string; params: unknown[]; error?: undefined } | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "bad request body" };
  const i = input as Record<string, unknown>;
  if (typeof i.method !== "string" || !RPC_METHODS.has(i.method)) return { error: "method not allowed" };
  if (i.params != null && !Array.isArray(i.params)) return { error: "bad params" };
  return { method: i.method, params: (i.params as unknown[]) ?? [] };
}
