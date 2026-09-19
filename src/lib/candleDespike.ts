/**
 * Candle despike — the client half of the corroboration rule.
 *
 * This is a faithful port of the server's `history/src/db/ohlcv_despike.rs`.
 * The two MUST stay in step: the chart draws bars from three sources — the
 * REST history, the server-pushed `ohlcv` candle, and the live trade tape — and
 * if they disagree the chart visibly rewrites itself as a bar ages from one
 * source to the next. One rule, one set of constants, three call sites.
 *
 * ## The rule
 *
 * A bar may only show a price that some ADJACENT bar's close stands behind.
 * Band = [min(prev.close, next.close), max(prev.close, next.close)]; anything
 * more than `TAU` outside it is pulled to the band edge.
 *
 * A move that HOLDS is confirmed by the next bar's close, which widens the band
 * with it — so real breakouts survive untouched and only excursions that revert
 * within one bar are trimmed. Measured on 281,741 production `ohlcv_1m` bars:
 * median range 1.0067 → 1.0063 (unchanged), p99 21.54 → 1.486, p99.9 1127 →
 * 12.93, 5.2% of bars touched. Not smoothing — it removes only what nothing
 * else confirms.
 *
 * ## Why not the bundle flag
 *
 * The obvious filter — "drop MEV/bundle trades" — was measured and does not
 * work: `is_bundle` is true on 54.2% of spike prints and 57.6% of ALL prints
 * (on Pumpfun 39.9% vs 62.3%, i.e. LESS). The flag says a trade was in a
 * bundle, not that its price is untradeable. Corroboration, not provenance.
 *
 * Full analysis: vault `10-Decisions/2026-08-08-ohlcv-clean-vs-raw-despike-design.md`
 */

/** Minimal OHLC shape — structurally compatible with the datafeed's `Bar`. */
export interface OhlcLike {
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Corroboration band width when a bar has a neighbour on BOTH sides.
 * Deliberately insensitive: 1.10 / 1.15 / 1.25 gave p95 3.41 / 3.62 / 3.69 on
 * the print-level equivalent, so the exact value is not load-bearing.
 */
export const TAU = 1.15;

/**
 * Band width when a bar has only ONE neighbour (first/last of a series).
 *
 * Much wider on purpose. At the edge there is no evidence to tell a launch
 * candle — which legitimately spans orders of magnitude — from a seed-price
 * artifact, so we only catch the catastrophic case. 50 mirrors the ingest-side
 * `OUTLIER_RATIO` in `history/src/db/ohlcv.rs`.
 */
export const EDGE_TAU = 50;

/** Two closes that agree with each other establish a regime; one does not. */
function agree(a: number, b: number): boolean {
  return a > 0 && b > 0 && a <= b * TAU && b <= a * TAU;
}

function clampInto(v: number, loRef: number, hiRef: number, band: number): number {
  if (v > hiRef * band) return hiRef;
  if (v < loRef / band) return loRef;
  return v;
}

/**
 * Clamp every bar into the band its neighbours' closes stand behind.
 * Mutates in place; returns how many bars were modified.
 *
 * Bars may be in either chronological direction — adjacency in the array is
 * what matters, and the test is symmetric.
 *
 * 🔑 Neighbour closes are snapshotted BEFORE any mutation, so the verdict never
 * depends on iteration order and a clamped bar can never end up justifying its
 * neighbour's excursion. This is also what makes the function IDEMPOTENT, which
 * is what lets it run safely on bars the server already filtered.
 */
export function despikeBars(bars: OhlcLike[]): number {
  if (bars.length < 2) return 0;

  const closes = bars.map((b) => b.close);
  let touched = 0;

  for (let i = 0; i < bars.length; i++) {
    const left = i > 0 ? closes[i - 1]! : 0;
    const right = i + 1 < closes.length ? closes[i + 1]! : 0;

    let loRef: number;
    let hiRef: number;
    let band: number;

    if (left > 0 && right > 0) {
      // Both sides. If the two disagree the band is wide and nothing is
      // clamped — a regime change between neighbours means "no verdict",
      // which is the safe direction.
      loRef = Math.min(left, right);
      hiRef = Math.max(left, right);
      band = TAU;
    } else if (left > 0 || right > 0) {
      // 🔴 One side only. A LONE neighbour is not evidence: judging against it
      // lets a spiking neighbour drag a perfectly good edge bar ONTO the spike
      // — the filter manufacturing the excursion it exists to remove. So the
      // pair beyond has to corroborate first; if those two disagree, this bar
      // gets no verdict at all.
      const near = left > 0 ? left : right;
      const second = left > 0
        ? (i >= 2 ? closes[i - 2]! : 0)
        : (i + 2 < closes.length ? closes[i + 2]! : 0);
      if (!agree(near, second)) continue;
      loRef = Math.min(near, second);
      hiRef = Math.max(near, second);
      band = EDGE_TAU;
    } else {
      // No usable neighbour (single bar, or both sides broken).
      continue;
    }

    const b = bars[i]!;
    const o = clampInto(b.open, loRef, hiRef, band);
    const c = clampInto(b.close, loRef, hiRef, band);
    let h = clampInto(b.high, loRef, hiRef, band);
    let l = clampInto(b.low, loRef, hiRef, band);
    // Restore the OHLC invariants the clamp can break.
    h = Math.max(h, o, c);
    l = Math.min(l, o, c);

    if (o !== b.open || h !== b.high || l !== b.low || c !== b.close) {
      b.open = o;
      b.high = h;
      b.low = l;
      b.close = c;
      touched++;
    }
  }

  return touched;
}

/**
 * The same rule over a plain price series — for surfaces that plot points
 * rather than candles (sparklines).
 *
 * Returns a NEW array; the caller should keep the raw series and derive this,
 * so a point can still be re-judged when its successor arrives instead of being
 * destroyed on first sight.
 *
 * The newest point has only one neighbour, so it gets the wide edge band and
 * survives — the sparkline stays responsive — and is judged properly the moment
 * a later point lands. That matters because a sparkline rescales its whole
 * y-range from the buffer's min/max: one uncorroborated print pins the scale and
 * every real movement in the row collapses to a flat line with a needle.
 */
export function despikeSeries(vals: number[]): number[] {
  if (vals.length < 2) return vals.slice();
  const bars = vals.map((v) => ({ open: v, high: v, low: v, close: v }));
  despikeBars(bars);
  return bars.map((b) => b.close);
}

// ─────────────────────────────────────────────────────────────────────────────
// Live bar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The live bar cannot use the rule above: there IS no next bar yet, and a
 * one-sided verdict is precisely what was shown to be unsafe. But live we have
 * something the history path does not — the print stream itself. So the
 * corroboration happens between PRINTS instead of between bars.
 *
 * A print gets to extend the bar's high/low only once a later print stands
 * behind it. Until then it is *provisional*: it moves `close` immediately (it
 * really is the last traded price — the chart must stay responsive) but it does
 * not commit a wick. If the next print reverts, the provisional excursion is
 * dropped and the rendered wick RETRACTS to the corroborated envelope.
 *
 * That retraction is the whole point. Without it the bar keeps a wick that the
 * server will not return when the same bar is refetched, and the chart rewrites
 * its own history the moment the user reloads.
 *
 * Volume is never suppressed — an uncorroborated print is still a real trade.
 */
export class LiveBarGuard {
  /** Corroborated envelope: extremes at least two prints stand behind. */
  private hi = 0;
  private lo = 0;
  /** The print awaiting corroboration. 0 = none. */
  private pending = 0;
  /** Reference the pending print is judged against (previous accepted price). */
  private ref = 0;
  /** Bar identity — a new bucket resets everything. */
  private barTime = -1;

  /** Start (or restart) the envelope for a bar. `seed` is the bar's open. */
  reset(barTime: number, seed: number): void {
    this.barTime = barTime;
    this.hi = seed > 0 ? seed : 0;
    this.lo = seed > 0 ? seed : 0;
    this.pending = 0;
    this.ref = seed > 0 ? seed : 0;
  }

  /**
   * Take over an envelope computed elsewhere — used when a server-side
   * aggregate for this bucket arrives and supersedes what the print stream had
   * accumulated.
   *
   * This is NOT `reset`: resetting to the bar's open would throw the aggregate's
   * high/low away, and the very next print would re-render the bar from the open
   * alone — silently dropping the extremes the server just told us about.
   */
  adopt(barTime: number, high: number, low: number, close: number): void {
    this.barTime = barTime;
    this.hi = high > 0 ? high : 0;
    this.lo = low > 0 ? low : 0;
    this.pending = 0;
    this.ref = close > 0 ? close : 0;
  }

  get currentBarTime(): number {
    return this.barTime;
  }

  /**
   * The corroborated high — the envelope WITHOUT the provisional print.
   *
   * Anything that cannot be walked back later must read this, not the rendered
   * high: the monotonic ATH tracker would pin a provisional spike forever at a
   * price the chart retracts a moment later.
   */
  get confirmedHigh(): number {
    return this.hi;
  }

  /**
   * Fold a print into the bar. Returns the envelope to render, given that
   * `price` is the live close.
   *
   * The returned high/low always cover `price`, so the wick tracks the live
   * price while it IS the price — and falls back to the corroborated envelope
   * as soon as a later print supersedes it.
   */
  push(price: number): { high: number; low: number } {
    if (!(price > 0)) return this.render(this.ref);

    if (this.hi <= 0) {
      // First print of the bar seeds everything; nothing to corroborate against.
      this.hi = price;
      this.lo = price;
      this.ref = price;
      return this.render(price);
    }

    // Settle the previous print now that a successor exists. It is corroborated
    // when it sits within TAU of either side — the same both-sides test the
    // history rule uses, with (ref, price) as the two neighbours.
    if (this.pending > 0) {
      const p = this.pending;
      const outside =
        (p > this.ref * TAU || p < this.ref / TAU) &&
        (p > price * TAU || p < price / TAU);
      if (!outside) {
        this.commit(p);
        this.ref = p;
      }
      // Uncorroborated: it never enters the envelope. `ref` deliberately stays
      // on the last CORROBORATED price, so a spike cannot become the yardstick
      // that legitimises the next one.
      this.pending = 0;
    }

    this.pending = price;
    return this.render(price);
  }

  /**
   * No more prints are coming for this bar (it is closing, or the tape has gone
   * quiet). Resolve the pending print one-sidedly with the WIDE band, matching
   * how the history rule treats a bar it can only see one neighbour of.
   */
  settle(): { high: number; low: number } {
    if (this.pending > 0) {
      const p = this.pending;
      if (this.ref <= 0 || (p <= this.ref * EDGE_TAU && p >= this.ref / EDGE_TAU)) {
        this.commit(p);
        this.ref = p;
      }
      this.pending = 0;
    }
    return { high: this.hi, low: this.lo };
  }

  private commit(price: number): void {
    if (price > this.hi) this.hi = price;
    if (this.lo <= 0 || price < this.lo) this.lo = price;
  }

  private render(live: number): { high: number; low: number } {
    const hi = this.hi > 0 ? this.hi : live;
    const lo = this.lo > 0 ? this.lo : live;
    return {
      high: live > 0 ? Math.max(hi, live) : hi,
      low: live > 0 ? Math.min(lo, live) : lo,
    };
  }
}
