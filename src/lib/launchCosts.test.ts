import { test } from "node:test";
import assert from "node:assert/strict";
import { costSizes, estimateLaunchCost, fallbackRent } from "./launchCosts.ts";

const SOL = 1_000_000_000;
const lamports = (sol: number) => Math.round(sol * SOL);

test("fallbackRent: the rents measured on mainnet on 2026-10-14", () => {
  // getMinimumBalanceForRentExemption answers for these sizes.
  for (const [size, rent] of [[0, 650_240], [82, 1_066_800], [165, 1_488_440], [170, 1_513_840], [429, 2_829_560]] as const) {
    assert.equal(fallbackRent(size), rent, `size ${size}`);
  }
});

test("Pump.fun: the create's accounts and fees, and each buyer's", () => {
  const c = estimateLaunchCost({ platform: "pump", rent: fallbackRent, creatorBuys: false, buyers: 2 });
  const createRent = fallbackRent(420) + fallbackRent(166) + fallbackRent(170);
  // Two signatures, 400k units at the router's 50,000 micro-lamports.
  const createFee = 2 * 5_000 + 20_000;
  assert.equal(lamports(c.creatorSol), createRent + createFee);
  // A token account and the Pump.fun volume tracker; one signature, 600k units.
  const buyer = fallbackRent(170) + fallbackRent(137) + 5_000 + 30_000;
  assert.equal(lamports(c.perBuyerSol), buyer);
  assert.equal(lamports(c.totalSol), createRent + createFee + 2 * buyer);
  // Far below the 0.03 SOL the page used to assume for a create.
  assert.ok(c.creatorSol < 0.01);
});

test("the creator's buy adds its accounts, not another transaction", () => {
  const alone = estimateLaunchCost({ platform: "pump", rent: fallbackRent, creatorBuys: false, buyers: 0 });
  const buying = estimateLaunchCost({ platform: "pump", rent: fallbackRent, creatorBuys: true, buyers: 0 });
  assert.equal(lamports(buying.creatorSol - alone.creatorSol), fallbackRent(170) + fallbackRent(137));
});

test("the priority setting prices the compute the router asks for", () => {
  const fast = estimateLaunchCost({ platform: "raydium", rent: fallbackRent, cuPrice: 200_000, creatorBuys: false, buyers: 1 });
  const dflt = estimateLaunchCost({ platform: "raydium", rent: fallbackRent, creatorBuys: false, buyers: 1 });
  // LaunchLab buys ask 120k units: 24,000 lamports at 200k, 6,000 at 50k.
  assert.equal(lamports(fast.perBuyerSol - dflt.perBuyerSol), 18_000);
  // Its create asks 400k: 80,000 vs 20,000.
  assert.equal(lamports(fast.creatorSol - dflt.creatorSol), 60_000);
});

test("StonkFun: a Token-2022 mint, no Metaplex account", () => {
  const sizes = costSizes("raydium", "stonkfun");
  assert.ok(sizes.includes(501) && !sizes.includes(607));
  assert.ok(costSizes("raydium", "standard").includes(607));
});
