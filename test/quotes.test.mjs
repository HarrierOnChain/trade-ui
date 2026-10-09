/**
 * Quotes kept by the server: what reaches the router's `GET /quote`, the
 * slippage cap, and the token a trade must come back with.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createQuotes, quoteQuery, QuoteBook } from "../server/quotes.mjs";

const QUOTE = JSON.parse(fs.readFileSync(new URL("../src/lib/swap/fixtures/quote-sol-usdc.json", import.meta.url), "utf8"));
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const sp = (o) => new URLSearchParams(o);
const refused = (o, opts) => {
  try {
    quoteQuery(sp(o), opts);
  } catch (e) {
    return [e.status, e.code, e.message];
  }
  assert.fail("accepted");
};

describe("what the router is asked for a quote", () => {
  test("only the whitelisted parameters, in a fixed order", () => {
    const q = quoteQuery(sp({
      inputMint: SOL, outputMint: USDC, amount: "1000", slippageBps: "050", maxHops: "2",
      swapMode: "ExactOut", excludeDexes: "SolFi V2, PumpSwap", reserveKeys: "39",
      feeAccount: "x", platformFeeBps: "100", apiKey: "leak",
    }));
    assert.equal(
      q,
      `inputMint=${SOL}&outputMint=${USDC}&amount=1000&swapMode=ExactOut&slippageBps=50` +
        "&excludeDexes=SolFi+V2%2CPumpSwap&maxHops=2",
    );
    assert.match(quoteQuery(sp({ inputMint: SOL, outputMint: USDC, amount: "1" }), { allowSplit: true }), /&allowSplit=true$/);
  });

  test("a bad request is refused", () => {
    assert.deepEqual(refused({ inputMint: SOL, outputMint: SOL, amount: "1" }), [400, "bad_request", "input and output are the same token"]);
    assert.equal(refused({ inputMint: SOL, outputMint: USDC, amount: "0" })[2], "bad amount");
    assert.equal(refused({ inputMint: SOL, outputMint: USDC, amount: "18446744073709551616" })[2], "bad amount");
    assert.equal(refused({ inputMint: SOL, outputMint: USDC, amount: "1", swapMode: "Both" })[2], "bad swapMode");
    assert.equal(refused({ inputMint: SOL, outputMint: USDC, amount: "1", maxHops: "9" })[2], "bad maxHops");
    assert.equal(refused({ inputMint: SOL, outputMint: USDC, amount: "1", excludeDexes: "a&b=c" })[2], "bad excludeDexes");
    assert.equal(refused({ inputMint: "x", outputMint: USDC, amount: "1" })[2], "bad mint");
  });

  test("slippage above the cap is refused, whatever the browser asks", () => {
    assert.deepEqual(refused({ inputMint: SOL, outputMint: USDC, amount: "1", slippageBps: "5001" }).slice(0, 2), [400, "slippage_cap"]);
    assert.match(quoteQuery(sp({ inputMint: SOL, outputMint: USDC, amount: "1", slippageBps: "5000" })), /slippageBps=5000/);
    assert.equal(refused({ inputMint: SOL, outputMint: USDC, amount: "1", slippageBps: "101" }, { maxSlippageBps: 100 })[1], "slippage_cap");
    assert.equal(refused({ inputMint: SOL, outputMint: USDC, amount: "1", slippageBps: "10001" })[2], "bad slippageBps");
  });
});

describe("the quotes kept", () => {
  test("a token gives back the quote for a minute, then nothing", () => {
    let now = 0;
    const book = new QuoteBook({ now: () => now });
    const t = book.put(QUOTE);
    assert.match(t, /^[A-Za-z0-9_-]{22}$/);
    assert.notEqual(book.put(QUOTE), t);
    assert.equal(book.get(t), QUOTE);
    now = 60_000;
    assert.equal(book.get(t), QUOTE);
    now = 60_001;
    assert.equal(book.get(t), null);
    assert.equal(book.get("made-up"), null);
    assert.equal(book.get({}), null);
    const u = book.put(QUOTE);
    book.clear();
    assert.equal(book.get(u), null);
  });

  test("the router's answer goes back with its token; the key goes to the router only", async () => {
    const seen = [];
    const fakeFetch = async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(QUOTE));
    };
    const quotes = createQuotes({ routerBase: "http://router", apiKey: "k_1", allowSplit: false, maxSlippageBps: 5000 }, { fetch: fakeFetch });
    const out = await quotes.quote(sp({ inputMint: SOL, outputMint: USDC, amount: "1000" }));
    assert.equal(out.status, 200);
    assert.equal(out.body.outAmount, QUOTE.outAmount);
    assert.deepEqual(quotes.book.get(out.body.quoteToken), QUOTE);
    assert.equal(seen[0].url, `http://router/quote?inputMint=${SOL}&outputMint=${USDC}&amount=1000`);
    assert.equal(seen[0].init.headers["x-api-key"], "k_1");
    assert.equal(seen[0].init.redirect, "error");
  });

  test("router refusals: the key named, no route as the router said it, nothing kept", async () => {
    const answer = (status, body) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    const cfg = { routerBase: "http://router", apiKey: "k", allowSplit: false, maxSlippageBps: 5000 };
    const ask = (fetch) => createQuotes(cfg, { fetch }).quote(sp({ inputMint: SOL, outputMint: USDC, amount: "1" }));

    let out = await ask(answer(401, { error: "unauthorized" }));
    assert.deepEqual([out.status, out.body.error], [502, "upstream_unauthorized"]);
    assert.match(out.body.reason, /RAZE_API_KEY/);
    out = await ask(answer(404, { error: "no_route", reason: "no pool" }));
    assert.deepEqual(out, { status: 404, body: { error: "no_route", reason: "no pool" } });
    out = await ask(answer(200, { notAQuote: true }));
    assert.equal(out.status, 502);
    assert.equal("quoteToken" in out.body, false);
    out = await ask(answer(502, "<html>bad gateway</html>"));
    assert.deepEqual([out.status, out.body.error], [502, "upstream_unavailable"]);
    out = await ask(async () => { throw new TypeError("fetch failed"); });
    assert.deepEqual([out.status, out.body.error], [502, "upstream_unavailable"]);
  });
});
