/**
 * Parity test against the shared Rust/TS despike fixture.
 * Run: `npx --yes tsx src/lib/candleDespike.parity.test.ts` from app.raze.bot.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { despikeBars, TAU, EDGE_TAU, type OhlcLike } from "./candleDespike.ts";

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, "ohlcv_despike_parity.json"), "utf8");
const fix = JSON.parse(raw) as {
  ratio: number;
  edge_ratio: number;
  cases: Array<{
    name: string;
    input: OhlcLike[];
    expected: OhlcLike[];
    touched: number;
  }>;
};

if (fix.ratio !== TAU) {
  throw new Error(`TAU mismatch: fixture ${fix.ratio} vs TS ${TAU}`);
}
if (fix.edge_ratio !== EDGE_TAU) {
  throw new Error(`EDGE_TAU mismatch: fixture ${fix.edge_ratio} vs TS ${EDGE_TAU}`);
}

let failed = 0;
for (const c of fix.cases) {
  const bars = c.input.map((b) => ({ ...b }));
  const touched = despikeBars(bars);
  if (touched !== c.touched) {
    console.error(`${c.name}: touched ${touched} != ${c.touched}`);
    failed++;
    continue;
  }
  for (let i = 0; i < bars.length; i++) {
    const got = bars[i]!;
    const want = c.expected[i]!;
    if (
      Math.abs(got.open - want.open) > 1e-12 ||
      Math.abs(got.high - want.high) > 1e-12 ||
      Math.abs(got.low - want.low) > 1e-12 ||
      Math.abs(got.close - want.close) > 1e-12
    ) {
      console.error(`${c.name}[${i}]: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
      failed++;
    }
  }
}

if (failed > 0) {
  console.error(`${failed} parity assertion(s) failed`);
  process.exit(1);
}
console.log(`ok — ${fix.cases.length} despike parity cases`);
