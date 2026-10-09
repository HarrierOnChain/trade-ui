/**
 * Quotes, kept by the server.
 *
 * `GET /api/swap/quote` asks the router and keeps its answer for a minute
 * under a random token, which goes back to the browser with the quote. To
 * trade it the browser sends the token, nothing else: the swap is built from
 * the quote exactly as the router gave it, so nothing the browser sends can
 * change the route, the amounts or the minimum it must receive. The slippage
 * a quote may ask for is capped (SWAP_MAX_SLIPPAGE_BPS, default 50 %).
 */
import crypto from "node:crypto";

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Venue labels as `GET /venues` spells them ("Raydium AMM V4", "SolFi V2"). */
const DEX_RE = /^[A-Za-z0-9 ._-]{1,40}$/;
const U64_MAX = (1n << 64n) - 1n;
const TTL_MS = 60_000;
const MAX_KEPT = 2000;

export class QuoteError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * The quote parameters forwarded to the router's `GET /quote`, in a fixed
 * order; anything else is dropped. Throws a QuoteError (400) on a bad one.
 */
export function quoteQuery(sp, { allowSplit = false, maxSlippageBps = 5000 } = {}) {
  const bad = (m) => new QuoteError(400, "bad_request", m);
  const inputMint = sp.get("inputMint") || "";
  const outputMint = sp.get("outputMint") || "";
  const amount = sp.get("amount") || "";
  if (!MINT_RE.test(inputMint) || !MINT_RE.test(outputMint)) throw bad("bad mint");
  if (inputMint === outputMint) throw bad("input and output are the same token");
  if (!/^[1-9][0-9]{0,19}$/.test(amount) || BigInt(amount) > U64_MAX) throw bad("bad amount");
  const q = new URLSearchParams({ inputMint, outputMint, amount });
  const mode = sp.get("swapMode");
  if (mode != null && mode !== "") {
    if (mode !== "ExactIn" && mode !== "ExactOut") throw bad("bad swapMode");
    q.set("swapMode", mode);
  }
  const slip = sp.get("slippageBps");
  if (slip != null && slip !== "") {
    if (!/^[0-9]{1,5}$/.test(slip) || Number(slip) > 10_000) throw bad("bad slippageBps");
    if (Number(slip) > maxSlippageBps) {
      throw new QuoteError(400, "slippage_cap", `Slippage above ${maxSlippageBps / 100}% is off on this Trade UI (SWAP_MAX_SLIPPAGE_BPS)`);
    }
    q.set("slippageBps", String(Number(slip)));
  }
  const ex = sp.get("excludeDexes");
  if (ex) {
    const list = ex.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length > 40 || !list.every((d) => DEX_RE.test(d))) throw bad("bad excludeDexes");
    if (list.length) q.set("excludeDexes", list.join(","));
  }
  const hops = sp.get("maxHops");
  if (hops != null && hops !== "") {
    if (!/^[1-4]$/.test(hops)) throw bad("bad maxHops");
    q.set("maxHops", hops);
  }
  if (allowSplit) q.set("allowSplit", "true");
  return q.toString();
}

/** The quotes handed out, by token, for a minute. */
export class QuoteBook {
  #kept = new Map();
  #now;

  constructor({ now = Date.now } = {}) {
    this.#now = now;
  }

  put(quote) {
    const token = crypto.randomBytes(16).toString("base64url");
    this.#kept.set(token, { quote, at: this.#now() });
    while (this.#kept.size > MAX_KEPT) this.#kept.delete(this.#kept.keys().next().value);
    return token;
  }

  /** The router's quote behind `token`, or null when unknown or expired. */
  get(token) {
    if (typeof token !== "string" || token.length > 64) return null;
    const hit = this.#kept.get(token);
    if (!hit) return null;
    if (this.#now() - hit.at > TTL_MS) {
      this.#kept.delete(token);
      return null;
    }
    return hit.quote;
  }

  clear() {
    this.#kept.clear();
  }
}

/**
 * @param {{ routerBase: string, apiKey: string, allowSplit: boolean, maxSlippageBps: number }} config
 * @param {{ fetch?: typeof fetch, book?: QuoteBook }} [deps]
 */
export function createQuotes(config, deps = {}) {
  const doFetch = deps.fetch ?? fetch;
  const book = deps.book ?? new QuoteBook();

  return {
    book,

    /** → router `GET /quote`. Resolves `{ status, body }` to send as JSON. */
    async quote(searchParams) {
      const query = quoteQuery(searchParams, { allowSplit: config.allowSplit, maxSlippageBps: config.maxSlippageBps });
      const headers = { accept: "application/json" };
      if (config.apiKey) headers["x-api-key"] = config.apiKey;
      let r;
      try {
        r = await doFetch(`${config.routerBase}/quote?${query}`, {
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        return { status: 502, body: { error: "upstream_unavailable", reason: "router unreachable" } };
      }
      const text = await r.text();
      let j;
      try {
        j = JSON.parse(text);
      } catch {
        return { status: r.status >= 400 ? r.status : 502, body: { error: "upstream_unavailable", reason: `router answered ${r.status}` } };
      }
      if (r.status === 401 || r.status === 403) {
        return { status: 502, body: { error: "upstream_unauthorized", reason: "the router refused the API key: check RAZE_API_KEY" } };
      }
      if (r.status !== 200 || !j || typeof j !== "object" || !("outAmount" in j)) {
        return { status: r.status === 200 ? 502 : r.status, body: j };
      }
      return { status: 200, body: { ...j, quoteToken: book.put(j) } };
    },
  };
}
