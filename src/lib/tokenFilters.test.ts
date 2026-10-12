/**
 * The monitor column gate and the stored filter shape.
 * Run: `npm test` (or `node --test src/lib/tokenFilters.test.ts`) from trade-ui/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countActive,
  defaultFilters,
  isFiltering,
  isSpamToken,
  passesFilters,
  platformKey,
  reviveColumnFilters,
  tabCounts,
} from "./tokenFilters.ts";
import type { TokenEvent } from "../types";

const NOW = Date.parse("2026-10-10T12:00:00Z");

function row(over: Partial<TokenEvent> = {}): TokenEvent {
  return {
    mint_address: "M1",
    chain: "bsc",
    name: "Frog",
    symbol: "FROG",
    dex: "Flap",
    created_at: new Date(NOW - 30 * 60_000).toISOString(),
    ...over,
  };
}

test("a hidden launchpad is hidden on its own chain only", () => {
  const f = { ...defaultFilters(), hiddenPlatforms: { bsc: ["flap"] } };
  assert.equal(passesFilters(row(), f), false);
  assert.equal(passesFilters(row({ chain: "base" }), f), true);
  assert.equal(passesFilters(row({ dex: "Four.meme" }), f), true);
  // A launchpad never listed is never hidden.
  assert.equal(passesFilters(row({ dex: "BrandNew" }), f), true);
});

test("no launchpad is a launchpad of its own", () => {
  assert.equal(platformKey(""), "");
  assert.equal(platformKey("  Four.meme "), "four.meme");
  const f = { ...defaultFilters(), hiddenPlatforms: { bsc: [""] } };
  assert.equal(passesFilters(row({ dex: "" }), f), false);
  assert.equal(passesFilters(row(), f), true);
});

test("a value the row lacks fails a range, unless optimistic", () => {
  const f = { ...defaultFilters(), top10Percent: { max: 30 } };
  assert.equal(passesFilters(row(), f), false);
  assert.equal(passesFilters(row(), f, { optimistic: true }), true);
  assert.equal(passesFilters(row({ top10Percent: 18 }), f), true);
  assert.equal(passesFilters(row({ top10Percent: 45 }), f, { optimistic: true }), false);
});

test("volume and trades filter on the row's own figures", () => {
  const f = { ...defaultFilters(), volume24h: { min: 2 }, tradeCount: { min: 10 } };
  assert.equal(passesFilters(row({ totalSolVolume: 2.5, tradeCount: 11 }), f), true);
  assert.equal(passesFilters(row({ totalSolVolume: 1.9, tradeCount: 11 }), f), false);
  assert.equal(passesFilters(row({ totalSolVolume: 2.5, tradeCount: 9 }), f), false);
});

test("age is minutes since creation", () => {
  const f = { ...defaultFilters(), ageMinutes: { max: 20 } };
  assert.equal(passesFilters(row(), f, { now: NOW }), false);
  assert.equal(passesFilters(row(), { ...f, ageMinutes: { min: 20, max: 40 } }, { now: NOW }), true);
});

test("only a known honeypot is hidden; renounce needs a yes", () => {
  const hp = { ...defaultFilters(), hideHoneypot: true };
  assert.equal(passesFilters(row(), hp), true);
  assert.equal(passesFilters(row({ honeypot: false }), hp), true);
  assert.equal(passesFilters(row({ honeypot: true }), hp), false);
  const mint = { ...defaultFilters(), requireMintRenounced: true };
  assert.equal(passesFilters(row(), mint), false);
  assert.equal(passesFilters(row(), mint, { optimistic: true }), true);
  assert.equal(passesFilters(row({ mintRenounced: false }), mint, { optimistic: true }), false);
  assert.equal(passesFilters(row({ mintRenounced: true }), mint), true);
});

test("socials need a non-empty link", () => {
  const f = { ...defaultFilters(), requireDiscord: true };
  assert.equal(passesFilters(row({ discord: "https://discord.gg/x" }), f), true);
  assert.equal(passesFilters(row({ discord: " " }), f), false);
  assert.equal(passesFilters(row({ discord: null }), f, { optimistic: true }), false);
});

test("dead tokens: no activity is dead, unknown activity only when strict", () => {
  assert.equal(isSpamToken(row({ tradeCount: 0, totalSolVolume: 0 })), true);
  assert.equal(isSpamToken(row({ tradeCount: 0 }), true), true);
  assert.equal(isSpamToken(row()), true);
  assert.equal(isSpamToken(row(), true), false);
  assert.equal(isSpamToken(row({ tradeCount: 3 })), false);
});

test("stored filters: old platform lists dropped, values checked", () => {
  const f = reviveColumnFilters({
    spam: true,
    platforms: ["Pumpfun", "Mayhem"],
    search: "cat",
    hiddenPlatforms: { sol: ["Mayhem", "mayhem", 3], bsc: "flap" },
    marketCap: { min: 5000, max: "x" },
    bundlePercentage: { max: 20 },
    requireTwitter: true,
    hideHoneypot: "yes",
  });
  assert.equal("platforms" in f, false);
  assert.deepEqual(f.hiddenPlatforms, { sol: ["mayhem"] });
  assert.deepEqual(f.marketCap, { min: 5000 });
  assert.deepEqual(f.bundlePercentage, { max: 20 });
  assert.equal(f.requireTwitter, true);
  assert.equal(f.hideHoneypot, false);
  assert.deepEqual(f.holders, {});
  assert.deepEqual(reviveColumnFilters(null), defaultFilters());
});

test("active counts are per chain", () => {
  const f = {
    ...defaultFilters(),
    hiddenPlatforms: { sol: ["mayhem"] },
    top10Percent: { max: 30 },
    hideHoneypot: true,
    liquidity: { min: 1000 },
    requireTelegram: true,
  };
  assert.deepEqual(tabCounts(f, "sol"), { protocols: 1, audit: 2, metrics: 1, socials: 1 });
  assert.equal(tabCounts(f, "bsc").protocols, 0);
  assert.equal(countActive(f, "sol"), 5);
  assert.equal(countActive(defaultFilters(), "sol"), 0);
  assert.equal(isFiltering(defaultFilters()), false);
  assert.equal(isFiltering({ ...defaultFilters(), hiddenPlatforms: { eth: ["livo"] } }), true);
});
