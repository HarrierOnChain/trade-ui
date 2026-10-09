"use client";
import React, { useEffect, useMemo, useRef, memo, useState } from "react";
import {
  applyRazeChartChrome,
  razeChartOptions,
  razeWidgetCtor,
  TOKEN_CHART_INTERVALS,
  type IChartingLibraryWidget,
  type ResolutionString,
  type ThemeName,
  type Mark,
  type EntityId,
} from "../../lib/razeChart";
import {
  getSolanaDatafeedInstance,
  destroySolanaDatafeedInstance,
  type ATHInfo,
} from "../SolanaDatafeed";
import { useSelectedToken } from "../../contexts/SelectedTokenContext";
import { getActiveChain, nativeSymbol } from "../../lib/chains";
import { barRangeFromChartTime } from "../../lib/chartInterval";
import { mountRightPanelToggleButton } from "./rightPanelToggle";
import { clampLeft, clampTop, viewportMaxWidth } from "../../lib/popover";
import styles from "./styles.module.css";

export type MarkKind = "dev" | "user" | "filtered" | "ath" | "migration";
/** Kinds that can also draw a horizontal price line on the chart.
 *  `dev` is excluded (no aggregate of dev trades on a horizontal line).
 *  `migration` is excluded (a single point-in-time event, not a price level).
 *  `migration_threshold` is line-only (a fixed reference price, no marks). */
export type LineKind =
  | Exclude<MarkKind, "dev" | "migration">
  | "migration_threshold";
/** Side discriminator for line entries. ATH and migration-threshold are
 *  single-line kinds with no buy/sell split. */
type LineSide = "buy" | "sell" | "ath" | "level";

export interface TradeMark {
  id: string;
  /** unix ms */
  time: number;
  kind: MarkKind;
  side: "buy" | "sell";
  label?: string;
  text?: string;
  /**
   * Price in the chart's current y-axis scale (respect `currency`+`display`).
   * Participates in the weighted-average horizontal line: the chart draws
   * one line per (kind, side) at Σ(price × solAmount) / Σ(solAmount) so a
   * 100-SOL trade dominates a 0.01-SOL trade in the average.
   */
  price?: number;
  /**
   * SOL size of this trade, used as the weight in the weighted avg line.
   * Trades without a positive SOL amount are excluded from the average.
   */
  solAmount?: number;
}

interface Props {
  /** If omitted, reads from SelectedTokenContext */
  mint?: string;
  interval?: ResolutionString;
  theme?: ThemeName;
  currency?: "usd" | "sol";
  display?: "mcap" | "price";
  onCurrencyChange?: (c: "usd" | "sol") => void;
  onDisplayChange?: (d: "mcap" | "price") => void;
  /** Trade marks to render on the chart, filterable via the toolbar dropdown. */
  marks?: TradeMark[];
  /** ISO timestamp (or unix-ms) of the token's bonding-curve→AMM migration.
   *  When present, a single "M" pin is drawn on that bar. */
  migratedAt?: string | number | null;
  /** Live SOL/USD price — used to position the Migration Threshold line at
   *  the same value the footer's bonding-curve readout shows. */
  solPrice?: number | null;
  /** Token supply — used to convert the threshold market cap to a per-token
   *  price when the chart is in price mode. */
  supply?: number | null;
  /** The token is still on a Pump.fun bonding curve: only then does the
   *  Migration Threshold line mean something. */
  onBondingCurve?: boolean;
  /** Right-click chart → "Filter Timestamp" applies this bar's time range. */
  onFilterTimestamp?: (range: { minMs: number; maxMs: number }) => void;
  /** Current visibility of the column to the right of the chart (trades tape).
   *  Drives the toolbar toggle's icon. When `onToggleRightPanel` is omitted the
   *  toggle button is not mounted. */
  rightPanelVisible?: boolean;
  /** Toggle the right-of-chart column. Mounting the toolbar button is gated on
   *  this being provided. */
  onToggleRightPanel?: () => void;
}

const INTERVAL_STORAGE_KEY = "tvchart:interval";
// Keys bumped to v4 when `migration` was added so existing users see it
// enabled by default (prior bumps: v1→v2 added `filtered`, v2→v3 added `ath`).
const MARKS_ENABLED_KEY = "tvchart:marks.enabled.v4";
// Bumped to v4 when `migration_threshold` was added so existing users see
// it enabled by default.
const LINES_ENABLED_KEY = "tvchart:lines.enabled.v5";
const SUPPORTED_INTERVALS = new Set<string>(["1S", "5S", "15S", "30S", "1", "5", "15", "30", "60", "240", "1D"]);

// `ath` deliberately omitted: it has no pin (a moving pin keyed by the ATH
// timestamp would force a chart-wide clearMarks on every new high — the
// flash the user sees on a pumping token). The All-Time High level is
// surfaced via the Lines dropdown instead.
const MARK_KINDS: MarkKind[] = ["dev", "user", "filtered", "migration"];
const MARK_LABELS: Record<MarkKind, string> = {
  dev: "Dev trades",
  user: "My wallets",
  filtered: "Filtered wallet",
  ath: "All-Time High",
  migration: "Token Migration",
};
const MARK_COLORS: Record<MarkKind, string> = {
  dev: "#e5b34a",      // amber — the creator
  user: "#66d89e",     // green — own wallets
  filtered: "#c084fc", // purple — the wallet set via the Transactions filter
  ath: "#facc15",      // gold — peak price
  migration: "#3b82f6",// blue — graduation from bonding curve to AMM
};
const SELL_COLOR = "#e57359"; // same red as the down candle
const BUY_COLOR  = "#66d89e"; // same green as the up candle
const ATH_COLOR  = MARK_COLORS.ath;
const MIGRATION_COLOR = MARK_COLORS.migration;

// Lines dropdown — dev intentionally excluded. `filtered` only appears in
// the dropdown as a toggle; its underlying data is fed by the Transactions
// filter, and when no filter is set there's simply nothing to draw. `ath`
// pulls its level from the chart's bar history via the datafeed.
// `migration_threshold` is a fixed reference price (`solPrice × 411`,
// matching the footer's bonding-curve readout) — no underlying marks.
const LINE_KINDS: LineKind[] = ["user", "filtered", "ath", "migration_threshold"];
const LINE_LABELS: Record<LineKind, string> = {
  user: "My Wallets",
  filtered: "Filtered Wallet",
  ath: "All-Time High",
  migration_threshold: "Migration Threshold",
};
// SOL-denominated reference for the migration / bonding-curve graduation
// level. Derived from Pump.fun's constant-product curve: at ~85 SOL real
// deposit, virtual reserves give ~411 SOL of fully-diluted market cap
// (k = 30 × 1.073e9; (30+85) × tokens_left = k → mcap ≈ 411 SOL).
// Mirrors `bondingCurve = solPrice × 411` in StatusFooter.tsx so the
// line on the chart and the readout in the footer stay in lockstep.
const MIGRATION_THRESHOLD_SOL = 411;

function readStoredLineKinds(): Set<LineKind> {
  const all = new Set<LineKind>(LINE_KINDS);
  if (typeof window === "undefined") return all;
  try {
    const raw = window.localStorage.getItem(LINES_ENABLED_KEY);
    if (!raw) return all;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const filtered = parsed.filter((k): k is LineKind => LINE_KINDS.includes(k as LineKind));
      return new Set(filtered);
    }
  } catch { /* ignore */ }
  return all;
}

function writeStoredLineKinds(set: Set<LineKind>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LINES_ENABLED_KEY, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

function readStoredMarkKinds(): Set<MarkKind> {
  const all = new Set<MarkKind>(MARK_KINDS);
  if (typeof window === "undefined") return all;
  try {
    const raw = window.localStorage.getItem(MARKS_ENABLED_KEY);
    if (!raw) return all;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const filtered = parsed.filter((k): k is MarkKind => MARK_KINDS.includes(k));
      return new Set(filtered);
    }
  } catch { /* ignore */ }
  return all;
}

function writeStoredMarkKinds(set: Set<MarkKind>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MARKS_ENABLED_KEY, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

function readStoredInterval(fallback: ResolutionString): ResolutionString {
  if (typeof window === "undefined") return fallback;
  try {
    const saved = window.localStorage.getItem(INTERVAL_STORAGE_KEY);
    if (saved && SUPPORTED_INTERVALS.has(saved)) {
      return saved as ResolutionString;
    }
  } catch { /* ignore */ }
  return fallback;
}

export const TVChart = memo(function TVChart({
  mint: mintProp,
  interval = "1" as ResolutionString,
  theme = "dark" as ThemeName,
  currency: currencyProp,
  display: displayProp,
  onCurrencyChange,
  onDisplayChange,
  marks,
  migratedAt,
  solPrice,
  supply,
  onBondingCurve = false,
  onFilterTimestamp,
  rightPanelVisible,
  onToggleRightPanel,
}: Props) {
  const { selectedMint } = useSelectedToken();
  const mint = mintProp ?? selectedMint;

  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef    = useRef<IChartingLibraryWidget | null>(null);
  const [currencyLocal, setCurrencyLocal] = useState<"usd" | "sol">("usd");
  const [displayLocal,  setDisplayLocal]  = useState<"mcap" | "price">("mcap");
  const currency = currencyProp ?? currencyLocal;
  const display  = displayProp  ?? displayLocal;
  const setCurrency = onCurrencyChange ?? setCurrencyLocal;
  const setDisplay  = onDisplayChange  ?? setDisplayLocal;

  // Marks: which kinds are shown + the latest trade list. Held in refs so
  // the datafeed provider always reads current values without having to
  // tear down/recreate the widget on every update.
  const enabledKindsRef = useRef<Set<MarkKind>>(readStoredMarkKinds());
  const marksRef = useRef<TradeMark[]>(marks ?? []);
  const prevMarkIdsRef = useRef<Set<string>>(new Set());
  // Horizontal lines state. `enabledLinesRef` drives the lines dropdown;
  // `lineEntitiesRef` maps a stable key ("<kind>:<side>") to the TV shape
  // entity id + last-painted price, so we can nudge an existing line via
  // setPoints when a new trade shifts the weighted avg without tearing the
  // shape down. `pendingLinesRef` records keys whose createShape promise
  // is in flight so paintLines doesn't spawn a duplicate before the first
  // promise resolves.
  const enabledLinesRef = useRef<Set<LineKind>>(readStoredLineKinds());
  const lineEntitiesRef = useRef<Map<string, { id: EntityId; price: number; time: number }>>(new Map());
  const pendingLinesRef = useRef<Set<string>>(new Set());
  const paintLinesRef = useRef<() => void>(() => {});
  const onFilterTimestampRef = useRef(onFilterTimestamp);
  const currentResolutionRef = useRef<ResolutionString>(readStoredInterval(interval));
  useEffect(() => { onFilterTimestampRef.current = onFilterTimestamp; }, [onFilterTimestamp]);

  // Right-panel toggle: callback + visibility held in refs so the toolbar
  // button (mounted once, inside the widget) always reads current values
  // without tearing the widget down. `paintRightPanelBtnRef` lets the
  // prop-sync effect refresh the icon when visibility changes.
  const onToggleRightPanelRef = useRef(onToggleRightPanel);
  const rightPanelVisibleRef = useRef<boolean>(rightPanelVisible ?? true);
  const paintRightPanelBtnRef = useRef<() => void>(() => {});
  useEffect(() => { onToggleRightPanelRef.current = onToggleRightPanel; }, [onToggleRightPanel]);
  useEffect(() => {
    rightPanelVisibleRef.current = rightPanelVisible ?? true;
    paintRightPanelBtnRef.current();
  }, [rightPanelVisible]);
  // ATH for the current (mint, resolution). Populated/refreshed via the
  // datafeed's listener API; consumed by the marks provider and buildDesired.
  const athRef = useRef<ATHInfo | null>(null);
  // Migration timestamp (unix ms) for the current mint. Tracked in a ref so
  // the marks provider always reads the latest value without recreating the
  // widget on prop change.
  const migratedAtMsRef = useRef<number | null>(null);
  // Migration threshold inputs. Held in refs so paintLines re-reads the
  // latest values on every tick without us having to thread them through
  // the closure created at chart-ready time.
  const solPriceRef = useRef<number | null>(solPrice ?? null);
  const supplyRef = useRef<number | null>(supply ?? null);
  const currencyRef = useRef<"usd" | "sol">(currencyProp ?? "usd");
  const displayRef = useRef<"mcap" | "price">(displayProp ?? "mcap");
  const onBondingCurveRef = useRef(onBondingCurve);
  useEffect(() => {
    solPriceRef.current = solPrice ?? null;
    supplyRef.current = supply ?? null;
    currencyRef.current = currencyProp ?? currencyRef.current;
    displayRef.current = displayProp ?? displayRef.current;
    paintLinesRef.current?.();
  }, [solPrice, supply, currencyProp, displayProp]);

  useEffect(() => {
    onBondingCurveRef.current = onBondingCurve;
    paintLinesRef.current?.();
  }, [onBondingCurve]);

  const resolvedMigratedAtMs = useMemo<number | null>(() => {
    if (migratedAt == null) return null;
    if (typeof migratedAt === "number") {
      return Number.isFinite(migratedAt)
        // Accept both unix-seconds and unix-ms — anything below year-2001
        // (~10^9) is almost certainly seconds.
        ? (migratedAt < 1e12 ? migratedAt * 1000 : migratedAt)
        : null;
    }
    const parsed = Date.parse(migratedAt);
    return Number.isFinite(parsed) ? parsed : null;
  }, [migratedAt]);
  useEffect(() => {
    migratedAtMsRef.current = resolvedMigratedAtMs;
    // Bounce the marks cache so the new pin paints (or the old one clears).
    try {
      const chart = widgetRef.current?.activeChart();
      if (chart) {
        chart.clearMarks();
        chart.refreshMarks();
      }
    } catch { /* chart not ready */ }
  }, [resolvedMigratedAtMs]);
  useEffect(() => {
    const nextMarks = marks ?? [];
    marksRef.current = nextMarks;

    // Only bounce the TV marks cache when IDs actually change. Repainting
    // every WS tick (which is what `clearMarks` triggers) caused a visible
    // flash on each new candle even when no mark was added or removed.
    const nextIds = new Set<string>();
    for (const m of nextMarks) nextIds.add(m.id);
    const prev = prevMarkIdsRef.current;
    let added = false;
    let removed = false;
    for (const id of nextIds) if (!prev.has(id)) { added = true; break; }
    for (const id of prev) if (!nextIds.has(id)) { removed = true; break; }
    prevMarkIdsRef.current = nextIds;

    try {
      const chart = widgetRef.current?.activeChart();
      // clearMarks drops TV's internal cache of prior marks; do it only when
      // we're removing something (e.g. a filter cleared). For pure additions
      // refreshMarks alone re-requests and keeps existing pins in place.
      if (chart) {
        if (removed) chart.clearMarks();
        if (added || removed) chart.refreshMarks();
      }
    } catch { /* chart not ready */ }
    paintLinesRef.current();
  }, [marks]);

  useEffect(() => {
    if (!mint || !containerRef.current) {
      widgetRef.current?.remove();
      widgetRef.current = null;
      return;
    }

    widgetRef.current?.remove();
    widgetRef.current = null;

    const datafeed = getSolanaDatafeedInstance();
    datafeed.setMode(currency, display);

    // Feed marks from the React-side ref. Uses `enabledKindsRef` so the
    // dropdown's toggles re-filter without recreating the widget — the
    // button handler just calls `activeChart().refreshMarks()`.
    datafeed.setMarksProvider((from, to) => {
      const enabled = enabledKindsRef.current;
      const fromMs = from * 1000;
      const toMs = to * 1000;
      const out: Mark[] = [];
      for (const m of marksRef.current) {
        if (!enabled.has(m.kind)) continue;
        if (m.time < fromMs || m.time > toMs) continue;
        // Dev / filtered marks use their own single-letter label
        // (D/F) with candle-matched colors: green buys, red sells. Other
        // kinds keep B/S labels; their buys take the kind color, sells
        // always use the red down-candle color.
        const KIND_LETTER: Partial<Record<MarkKind, string>> = {
          dev: "D",
          filtered: "F",
        };
        const letter = KIND_LETTER[m.kind];
        const color =
          m.side === "sell"
            ? SELL_COLOR
            : letter
              ? BUY_COLOR
              : MARK_COLORS[m.kind];
        const label = m.label ?? (letter ?? (m.side === "buy" ? "B" : "S"));
        out.push({
          id: m.id,
          time: Math.floor(m.time / 1000),
          color: { border: color, background: color },
          text: m.text ?? `${MARK_LABELS[m.kind]} · ${m.side.toUpperCase()}`,
          label,
          labelFontColor: "#181615",
          minSize: 16,
        });
      }
      // ATH is rendered as a horizontal price-level line via paintLinesRef
      // (label "All-Time High"); intentionally no pin mark here. A pin keyed
      // by the ATH timestamp would change id on every new high, forcing a
      // chart-wide clearMarks() to evict the previous pin — that's the flash
      // the user sees on a pumping token.
      // Migration pin — single "M" on the bar where the token graduated
      // from its bonding curve to an AMM. Sourced from the token-detail
      // page's REST data via the `migratedAt` prop.
      const migMs = migratedAtMsRef.current;
      if (enabled.has("migration") && migMs != null) {
        const mSec = Math.floor(migMs / 1000);
        if (mSec >= from && mSec <= to) {
          out.push({
            id: `migration:${migMs}`,
            time: mSec,
            color: { border: MARK_COLORS.migration, background: MARK_COLORS.migration },
            text: "Token Migration",
            label: "M",
            labelFontColor: "#181615",
            minSize: 16,
          });
        }
      }
      return out;
    });

    const ChartWidget = razeWidgetCtor();
    const tvWidget = new ChartWidget(razeChartOptions({
      symbol: mint,
      datafeed,
      interval: readStoredInterval(interval),
      container: containerRef.current,
      disabled_features: [
        "study_templates",
        "display_market_status",
        "shift_visible_range_on_new_bar",
        "header_saveload",
        "use_localstorage_for_settings",
        "header_symbol_search",
        "symbol_search_hot_key",
        "header_compare",
        "popup_hints",
      ],
      theme,
      favorites: { intervals: TOKEN_CHART_INTERVALS },
      raze: {
        aria_label: `${mint} price chart`,
        aria_description: "Live token candles with trade marks and overlay lines.",
      },
    }));
    widgetRef.current = tvWidget;

    // ATH listener disposer; populated inside onChartReady once we know the
    // chart's resolution, re-bound when the interval changes, and disposed
    // by the useEffect cleanup below.
    let athDispose: (() => void) | null = null;

    tvWidget.onChartReady(() => {
      const chart = tvWidget.activeChart();
      try {
        currentResolutionRef.current = chart.resolution();
      } catch { /* ignore */ }

      if (onFilterTimestampRef.current) {
        tvWidget.onContextMenu((unixTime: number) => {
          if (!onFilterTimestampRef.current) return [];
          return [{
            position: "top",
            text: "Filter Timestamp",
            click: () => {
              const range = barRangeFromChartTime(
                unixTime,
                currentResolutionRef.current,
              );
              onFilterTimestampRef.current?.(range);
            },
          }];
        });
      }

      // Re-paint the ATH horizontal line. No mark/pin to evict, so we skip
      // the chart-wide clearMarks/refreshMarks that previously caused a
      // flash of every other pin on each new high.
      const repaintATH = () => {
        paintLinesRef.current();
      };

      const subscribeATHFor = (res: ResolutionString) => {
        athDispose?.();
        athRef.current = datafeed.getATH(mint, res);
        athDispose = datafeed.addATHListener(mint, res, (next) => {
          athRef.current = next;
          repaintATH();
        });
      };

      chart.onIntervalChanged().subscribe(null, (next: ResolutionString) => {
        currentResolutionRef.current = next;
        try { window.localStorage.setItem(INTERVAL_STORAGE_KEY, next); }
        catch { /* ignore */ }
        // Different resolutions have their own bar series and therefore their
        // own ATH key in the datafeed cache. Swap subscriptions and repaint
        // so the line/mark snap to the new resolution's value.
        subscribeATHFor(next);
        repaintATH();
      });

      // Horizontal-line painter — aggregates marks by (kind, side) into a
      // volume-weighted average price and draws ONE line per group. A
      // 100-SOL trade dominates a 0.01-SOL trade in the average because the
      // weight is the trade's SOL size. Re-running paint adjusts existing
      // shapes via setPoints instead of tearing them down, so on every
      // streamed trade the lines slide to the new avg without flashing.

      type Agg = { priceSum: number; solSum: number; latestTime: number };
      const buildDesired = () => {
        const enabled = enabledLinesRef.current;
        // key = "<kind>:<side>"
        const groups = new Map<string, { kind: LineKind; side: LineSide; agg: Agg }>();
        for (const m of marksRef.current) {
          if (m.kind === "dev") continue;
          if (m.kind === "migration") continue; // point-in-time, no line
          const k = m.kind as LineKind;
          if (k === "ath") continue; // ATH is not aggregated from trades
          if (!enabled.has(k)) continue;
          if (typeof m.price !== "number" || !Number.isFinite(m.price)) continue;
          const w = typeof m.solAmount === "number" ? m.solAmount : 0;
          if (w <= 0) continue;
          const key = `${k}:${m.side}`;
          let g = groups.get(key);
          if (!g) {
            g = { kind: k, side: m.side, agg: { priceSum: 0, solSum: 0, latestTime: 0 } };
            groups.set(key, g);
          }
          g.agg.priceSum += m.price * w;
          g.agg.solSum += w;
          if (m.time > g.agg.latestTime) g.agg.latestTime = m.time;
        }
        const desired = new Map<string, { kind: LineKind; side: LineSide; price: number; time: number }>();
        for (const [key, g] of groups) {
          if (g.agg.solSum <= 0) continue;
          desired.set(key, {
            kind: g.kind,
            side: g.side,
            price: g.agg.priceSum / g.agg.solSum,
            time: g.agg.latestTime || Date.now(),
          });
        }
        // ATH line — single horizontal at the highest bar high we've seen.
        const ath = athRef.current;
        if (enabled.has("ath") && ath && Number.isFinite(ath.price) && ath.price > 0) {
          desired.set("ath:ath", {
            kind: "ath",
            side: "ath",
            price: ath.price,
            time: ath.time,
          });
        }
        // Migration threshold — fixed reference price equal to the
        // bonding-curve graduation level (`MIGRATION_THRESHOLD_SOL` SOL,
        // matching the footer's `solPrice × 411` USD readout). Converted
        // to whatever scale the chart is currently rendering in.
        if (enabled.has("migration_threshold") && onBondingCurveRef.current) {
          const sp = solPriceRef.current ?? 0;
          const sup = supplyRef.current ?? 0;
          const cur = currencyRef.current;
          const disp = displayRef.current;
          let price = 0;
          if (cur === "usd" && disp === "mcap") {
            price = sp > 0 ? sp * MIGRATION_THRESHOLD_SOL : 0;
          } else if (cur === "usd" && disp === "price") {
            price = sp > 0 && sup > 0 ? (sp * MIGRATION_THRESHOLD_SOL) / sup : 0;
          } else if (cur === "sol" && disp === "mcap") {
            price = MIGRATION_THRESHOLD_SOL;
          } else {
            price = sup > 0 ? MIGRATION_THRESHOLD_SOL / sup : 0;
          }
          if (price > 0) {
            desired.set("migration_threshold:level", {
              kind: "migration_threshold",
              side: "level",
              price,
              time: Date.now(),
            });
          }
        }
        return desired;
      };

      const desiredStillWants = (key: string): boolean => buildDesired().has(key);

      paintLinesRef.current = () => {
        const desired = buildDesired();

        // Remove stale groups (kind toggled off, filter cleared, or every
        // trade in the group vanished).
        for (const [key, entry] of lineEntitiesRef.current) {
          if (desired.has(key)) continue;
          try { chart.removeEntity(entry.id); } catch { /* ignore */ }
          lineEntitiesRef.current.delete(key);
        }

        // Add or nudge existing lines.
        for (const [key, spec] of desired) {
          const timeSec = Math.floor(spec.time / 1000);
          const existing = lineEntitiesRef.current.get(key);
          if (existing) {
            // Only move the line if the weighted avg actually shifted —
            // avoids calling setPoints on every WS tick when the new trade
            // doesn't change the aggregate.
            if (existing.price === spec.price && existing.time === timeSec) continue;
            try {
              chart.getShapeById(existing.id).setPoints([{ time: timeSec, price: spec.price }]);
              existing.price = spec.price;
              existing.time = timeSec;
            } catch { /* shape gone — fall through to recreate */
              try { chart.removeEntity(existing.id); } catch { /* ignore */ }
              lineEntitiesRef.current.delete(key);
            }
            if (lineEntitiesRef.current.has(key)) continue;
          }
          if (pendingLinesRef.current.has(key)) continue;
          // Per-kind color: migration threshold uses its own blue, ATH uses
          // gold, everything else falls back to candle-color buy/sell.
          const color =
            spec.kind === "migration_threshold" ? MIGRATION_COLOR
            : spec.side === "buy" ? BUY_COLOR
            : spec.side === "sell" ? SELL_COLOR
            : ATH_COLOR;
          const kindLabel = LINE_LABELS[spec.kind];
          // "Filtered Wallet: Avg. Buy" / "My Wallets: Avg. Sell" — renders
          // above the dashed line via horzLabelsAlign/vertLabelsAlign on
          // linetoolhorzline. ATH and Migration Threshold get a single
          // kind label since they have no buy/sell split.
          const labelText =
            spec.side === "ath" ? "All-Time High"
            : spec.side === "level" ? kindLabel
            : `${kindLabel}: Avg. ${spec.side === "buy" ? "Buy" : "Sell"}`;
          let promise: Promise<EntityId> | undefined;
          try {
            promise = chart.createShape(
              { time: timeSec, price: spec.price },
              {
                shape: "horizontal_line",
                lock: true,
                disableSelection: true,
                disableSave: true,
                disableUndo: true,
                showInObjectsTree: false,
                zOrder: "bottom",
                text: labelText,
                overrides: {
                  linecolor: color,
                  linestyle: 2,        // dashed
                  linewidth: 1,
                  textcolor: color,
                  fontsize: 11,
                  bold: false,
                  italic: false,
                  horzLabelsAlign: "right",
                  vertLabelsAlign: "top",
                  showPrice: true,
                },
              },
            );
          } catch { /* ignore */ }
          if (promise) {
            const pendingKey = key;
            pendingLinesRef.current.add(pendingKey);
            promise.then((id) => {
              pendingLinesRef.current.delete(pendingKey);
              if (!id) return;
              if (!desiredStillWants(pendingKey)) {
                try { chart.removeEntity(id); } catch { /* ignore */ }
                return;
              }
              lineEntitiesRef.current.set(pendingKey, { id, price: spec.price, time: timeSec });
            }).catch(() => {
              pendingLinesRef.current.delete(pendingKey);
            });
          }
        }
      };

      // Hydrate ATH from the datafeed (it may already have bar history) and
      // subscribe for future updates BEFORE the initial paint, so the line
      // and "A" mark show up on first render when history is already cached.
      subscribeATHFor(chart.resolution() as ResolutionString);

      // Paint any marks that arrived before the chart was ready.
      paintLinesRef.current();
    });

    void tvWidget.headerReady().then(() => {
      applyRazeChartChrome(tvWidget);

      // ── MarketCap / Price toggle ──────────────────────────────────────────
      // useTradingViewStyle:false returns an HTMLElement so we can mount
      // rich content; font is left to inherit from the toolbar so the
      // typography matches native buttons like "Indicators".
      const tvBtnCss = [
        "cursor:pointer",
        "display:flex",
        "align-items:center",
        "gap:4px",
        "padding:0 8px",
        "border:none",
        "background:transparent",
        "font:inherit",
      ].join(";");

      const ACCENT = "#66d89e";
      const ACTIVE = "#f4eee1";
      const DIM = "#555";
      const SLASH = "#444";

      const renderToggle = (a: string, b: string, activeA: boolean, hover: boolean) => {
        const aColor = activeA ? (hover ? ACCENT : ACTIVE) : DIM;
        const bColor = !activeA ? (hover ? ACCENT : ACTIVE) : DIM;
        return [
          `<span style="color:${aColor}">${a}</span>`,
          `<span style="color:${SLASH}">/</span>`,
          `<span style="color:${bColor}">${b}</span>`,
        ].join("");
      };

      const wireHover = (btn: HTMLElement, paint: (hover: boolean) => void) => {
        btn.addEventListener("mouseenter", () => paint(true));
        btn.addEventListener("mouseleave", () => paint(false));
      };

      const dispBtn = tvWidget.createButton({ align: "left", useTradingViewStyle: false });
      dispBtn.title = "Toggle between Market Cap and Price";
      dispBtn.style.cssText = tvBtnCss;
      const paintDisp = (hover: boolean) => {
        dispBtn.innerHTML = renderToggle("MarketCap", "Price", display === "mcap", hover);
      };
      paintDisp(false);
      wireHover(dispBtn, paintDisp);
      dispBtn.addEventListener("click", () => setDisplay(display === "mcap" ? "price" : "mcap"));

      // ── USD / native (SOL) toggle ────────────────────────────────────────
      const nativeSym = nativeSymbol(getActiveChain());
      const currBtn = tvWidget.createButton({ align: "left", useTradingViewStyle: false });
      currBtn.title = `Toggle between USD and ${nativeSym} denomination`;
      currBtn.style.cssText = tvBtnCss;
      const paintCurr = (hover: boolean) => {
        currBtn.innerHTML = renderToggle("USD", nativeSym, currency === "usd", hover);
      };
      paintCurr(false);
      wireHover(currBtn, paintCurr);
      currBtn.addEventListener("click", () => setCurrency(currency === "usd" ? "sol" : "usd"));

      // ── Marks dropdown ────────────────────────────────────────────────────
      mountMarksButton(tvWidget, enabledKindsRef, tvBtnCss);
      // ── Lines dropdown ────────────────────────────────────────────────────
      mountLinesButton(tvWidget, enabledLinesRef, tvBtnCss, paintLinesRef);
      // ── Right-panel (trades column) show/hide toggle ──────────────────────
      if (onToggleRightPanelRef.current) {
        mountRightPanelToggleButton(
          tvWidget,
          tvBtnCss,
          () => rightPanelVisibleRef.current,
          () => onToggleRightPanelRef.current?.(),
          (paint) => { paintRightPanelBtnRef.current = paint; },
        );
      }

      tvWidget.activeChart().resetData();
      try { tvWidget.activeChart().refreshMarks(); } catch { /* ignore */ }
    });

    return () => {
      athDispose?.();
      athDispose = null;
      athRef.current = null;
      widgetRef.current?.remove();
      widgetRef.current = null;
      // The chart is gone → its entity IDs are stale. Drop them so the next
      // widget's painter starts from a clean slate. Pending promises may
      // still resolve after teardown — their resolved entities target a
      // removed chart, so we just ignore them by clearing pending keys too.
      lineEntitiesRef.current.clear();
      pendingLinesRef.current.clear();
      prevMarkIdsRef.current = new Set();
      paintLinesRef.current = () => {};
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint, theme, currency, display]);

  useEffect(() => () => { destroySolanaDatafeedInstance(); }, []);

  if (!mint) {
    return (
      <div className={styles.chart} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--paper-4)", fontSize: 13, fontStyle: "italic", fontFamily: "var(--font-dis)" }}>
          Select a token to view the chart
        </span>
      </div>
    );
  }

  return <div ref={containerRef} className={styles.chart} />;
});

// ── marks dropdown button ─────────────────────────────────────────────────────
// Lives in the TV toolbar (createButton returns an HTMLElement). Opens an
// absolutely-positioned menu with a checkbox per mark kind. Clicking toggles
// the kind in `enabledKindsRef` (persisted), then calls refreshMarks so the
// chart re-paints without tearing down the widget.
function mountMarksButton(
  tvWidget: IChartingLibraryWidget,
  enabledKindsRef: React.MutableRefObject<Set<MarkKind>>,
  tvBtnCss: string,
) {
  const btn = tvWidget.createButton({ align: "left", useTradingViewStyle: false });
  btn.title = "Filter chart marks";
  btn.style.cssText = tvBtnCss + ";position:relative";

  const paintLabel = (hover: boolean) => {
    const count = enabledKindsRef.current.size;
    const color = hover ? "#66d89e" : "#f4eee1";
    btn.innerHTML = [
      `<span style="color:${color}">Marks</span>`,
      `<span style="color:#555;font-size:10px;margin-left:2px">(${count}/${MARK_KINDS.length})</span>`,
      `<span style="color:${color};margin-left:2px">▾</span>`,
    ].join("");
  };
  paintLabel(false);
  btn.addEventListener("mouseenter", () => paintLabel(true));
  btn.addEventListener("mouseleave", () => paintLabel(false));

  // Menu is mounted to <body> to avoid being clipped by the TV toolbar's
  // overflow. Position is set from the button's bounding rect each time it
  // opens.
  const menu = document.createElement("div");
  menu.style.cssText = [
    "position:fixed",
    "min-width:180px",
    "background:#211f1d",
    "border:1px solid #3d3935",
    "border-radius:4px",
    "box-shadow:0 12px 24px -10px rgba(0,0,0,0.6)",
    "padding:4px",
    "z-index:2147483600",
    "display:none",
    "flex-direction:column",
    "gap:2px",
    "font-family:inherit",
    "font-size:12px",
    `max-width:${viewportMaxWidth()}`,
  ].join(";");
  document.body.appendChild(menu);

  const renderMenu = () => {
    menu.innerHTML = "";
    for (const kind of MARK_KINDS) {
      const row = document.createElement("div");
      row.style.cssText = [
        "display:flex",
        "align-items:center",
        "gap:8px",
        "padding:6px 8px",
        "cursor:pointer",
        "border-radius:3px",
        "color:#f4eee1",
      ].join(";");
      row.addEventListener("mouseenter", () => { row.style.background = "#272522"; });
      row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });

      const checked = enabledKindsRef.current.has(kind);
      const box = document.createElement("span");
      box.style.cssText = [
        "width:11px",
        "height:11px",
        "border-radius:2px",
        "border:1px solid " + (checked ? BUY_COLOR : "#3d3935"),
        "background:" + (checked ? BUY_COLOR : "transparent"),
        "display:inline-block",
        "flex-shrink:0",
      ].join(";");

      // Swatch shows the actual colors the mark paints with on the chart:
      // green for buys, red for sells. Kind-specific colors are dead since
      // buy/sell coloring overrides them. ATH and Migration are single-
      // color pins so each gets one swatch in its kind color.
      const swatch = document.createElement("span");
      swatch.style.cssText = "display:inline-flex;gap:3px;flex-shrink:0";
      swatch.innerHTML = kind === "ath"
        ? `<span style="width:6px;height:6px;border-radius:999px;background:${ATH_COLOR};display:inline-block"></span>`
        : kind === "migration"
        ? `<span style="width:6px;height:6px;border-radius:999px;background:${MIGRATION_COLOR};display:inline-block"></span>`
        : [
            `<span style="width:6px;height:6px;border-radius:999px;background:${BUY_COLOR};display:inline-block"></span>`,
            `<span style="width:6px;height:6px;border-radius:999px;background:${SELL_COLOR};display:inline-block"></span>`,
          ].join("");

      const label = document.createElement("span");
      label.textContent = MARK_LABELS[kind];
      label.style.cssText = "font-size:12px;flex:1";

      row.appendChild(box);
      row.appendChild(swatch);
      row.appendChild(label);

      row.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = new Set(enabledKindsRef.current);
        const removing = next.has(kind);
        if (removing) next.delete(kind);
        else next.add(kind);
        enabledKindsRef.current = next;
        writeStoredMarkKinds(next);
        renderMenu();
        paintLabel(false);
        // Deselect requires clearMarks: refreshMarks alone keeps existing
        // pins in TV's cache, so toggling a kind off would only update the
        // counter while the pins stayed on the chart.
        try {
          const chart = tvWidget.activeChart();
          if (removing) chart.clearMarks();
          chart.refreshMarks();
        } catch { /* ignore */ }
      });

      menu.appendChild(row);
    }
  };
  renderMenu();

  let open = false;
  const setOpen = (next: boolean) => {
    open = next;
    if (next) {
      const { top, left } = getMenuAnchor(btn);
      // Show first so the menu has measurable dimensions, then clamp into the
      // viewport (a button near the right/bottom edge would otherwise clip on
      // a narrow phone).
      menu.style.display = "flex";
      const w = menu.offsetWidth || 180;
      const h = menu.offsetHeight || 0;
      menu.style.left = `${clampLeft(left, w)}px`;
      menu.style.top = `${clampTop(top, h)}px`;
    } else {
      menu.style.display = "none";
    }
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!open);
  });

  const outside = (e: MouseEvent) => {
    if (!open) return;
    const target = e.target as Node;
    if (btn.contains(target) || menu.contains(target)) return;
    setOpen(false);
  };
  document.addEventListener("mousedown", outside);
}

// ── lines dropdown button ─────────────────────────────────────────────────────
// Mirror of mountMarksButton but for the horizontal-line overlay. Toggling a
// kind re-runs `paintLinesRef.current()` which diff-adds/removes shapes on
// the chart so the widget isn't torn down.
function mountLinesButton(
  tvWidget: IChartingLibraryWidget,
  enabledLinesRef: React.MutableRefObject<Set<LineKind>>,
  tvBtnCss: string,
  paintLinesRef: React.MutableRefObject<() => void>,
) {
  const btn = tvWidget.createButton({ align: "left", useTradingViewStyle: false });
  btn.title = "Filter chart lines";
  btn.style.cssText = tvBtnCss + ";position:relative";

  const paintLabel = (hover: boolean) => {
    const count = enabledLinesRef.current.size;
    const color = hover ? "#66d89e" : "#f4eee1";
    btn.innerHTML = [
      `<span style="color:${color}">Lines</span>`,
      `<span style="color:#555;font-size:10px;margin-left:2px">(${count}/${LINE_KINDS.length})</span>`,
      `<span style="color:${color};margin-left:2px">▾</span>`,
    ].join("");
  };
  paintLabel(false);
  btn.addEventListener("mouseenter", () => paintLabel(true));
  btn.addEventListener("mouseleave", () => paintLabel(false));

  const menu = document.createElement("div");
  menu.style.cssText = [
    "position:fixed",
    "min-width:180px",
    "background:#211f1d",
    "border:1px solid #3d3935",
    "border-radius:4px",
    "box-shadow:0 12px 24px -10px rgba(0,0,0,0.6)",
    "padding:4px",
    "z-index:2147483600",
    "display:none",
    "flex-direction:column",
    "gap:2px",
    "font-family:inherit",
    "font-size:12px",
    `max-width:${viewportMaxWidth()}`,
  ].join(";");
  document.body.appendChild(menu);

  const renderMenu = () => {
    menu.innerHTML = "";
    for (const kind of LINE_KINDS) {
      const row = document.createElement("div");
      row.style.cssText = [
        "display:flex",
        "align-items:center",
        "gap:8px",
        "padding:6px 8px",
        "cursor:pointer",
        "border-radius:3px",
        "color:#f4eee1",
      ].join(";");
      row.addEventListener("mouseenter", () => { row.style.background = "#272522"; });
      row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });

      const checked = enabledLinesRef.current.has(kind);

      const box = document.createElement("span");
      box.style.cssText = [
        "width:11px",
        "height:11px",
        "border-radius:2px",
        "border:1px solid " + (checked ? BUY_COLOR : "#3d3935"),
        "background:" + (checked ? BUY_COLOR : "transparent"),
        "display:inline-block",
        "flex-shrink:0",
      ].join(";");

      // Two dashed segments match the on-chart rendering: each kind paints
      // an Avg Buy line (green) and an Avg Sell line (red). ATH and
      // Migration Threshold each paint a single line, so they show one
      // segment in their kind color.
      const swatch = document.createElement("span");
      swatch.style.cssText = "display:inline-flex;flex-direction:column;gap:3px;flex-shrink:0";
      swatch.innerHTML = kind === "ath"
        ? `<span style="width:14px;height:0;border-top:1px dashed ${ATH_COLOR};display:inline-block"></span>`
        : kind === "migration_threshold"
        ? `<span style="width:14px;height:0;border-top:1px dashed ${MIGRATION_COLOR};display:inline-block"></span>`
        : [
            `<span style="width:14px;height:0;border-top:1px dashed ${BUY_COLOR};display:inline-block"></span>`,
            `<span style="width:14px;height:0;border-top:1px dashed ${SELL_COLOR};display:inline-block"></span>`,
          ].join("");

      const label = document.createElement("span");
      label.textContent = LINE_LABELS[kind];
      label.style.cssText = "font-size:12px;flex:1";

      row.appendChild(box);
      row.appendChild(swatch);
      row.appendChild(label);

      row.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = new Set(enabledLinesRef.current);
        if (next.has(kind)) next.delete(kind);
        else next.add(kind);
        enabledLinesRef.current = next;
        writeStoredLineKinds(next);
        renderMenu();
        paintLabel(false);
        paintLinesRef.current();
      });

      menu.appendChild(row);
    }
  };
  renderMenu();

  let open = false;
  const setOpen = (next: boolean) => {
    open = next;
    if (next) {
      const { top, left } = getMenuAnchor(btn);
      // Show first so the menu has measurable dimensions, then clamp into the
      // viewport (a button near the right/bottom edge would otherwise clip on
      // a narrow phone).
      menu.style.display = "flex";
      const w = menu.offsetWidth || 180;
      const h = menu.offsetHeight || 0;
      menu.style.left = `${clampLeft(left, w)}px`;
      menu.style.top = `${clampTop(top, h)}px`;
    } else {
      menu.style.display = "none";
    }
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!open);
  });

  const outside = (e: MouseEvent) => {
    if (!open) return;
    const target = e.target as Node;
    if (btn.contains(target) || menu.contains(target)) return;
    setOpen(false);
  };
  document.addEventListener("mousedown", outside);
}

// The chart toolbar may live in a nested document; menus are mounted on
// the outer <body>, so translate iframe-local coordinates when needed.
function getMenuAnchor(btn: HTMLElement): { top: number; left: number } {
  const rect = btn.getBoundingClientRect();
  const btnWin = btn.ownerDocument?.defaultView;
  if (btnWin && btnWin !== window) {
    const frame = btnWin.frameElement as HTMLIFrameElement | null;
    if (frame) {
      const frameRect = frame.getBoundingClientRect();
      return {
        top: rect.bottom + frameRect.top + 4,
        left: rect.left + frameRect.left,
      };
    }
  }
  return { top: rect.bottom + 4, left: rect.left };
}
