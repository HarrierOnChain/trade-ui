"use client";
import React, { useEffect, useRef, memo } from "react";
import {
  applyRazeChartChrome,
  PERP_CHART_INTERVALS,
  razeChartOptions,
  razeWidgetCtor,
  type IChartingLibraryWidget,
  type ITradingLineAdapter,
  type ResolutionString,
  type ThemeName,
  type Mark,
  type TradingLineEvent,
} from "../../lib/razeChart";
import {
  getPerpDatafeedInstance,
  destroyPerpDatafeedInstance,
} from "../PerpDatafeed";
import { mountRightPanelToggleButton } from "../TVChart/rightPanelToggle";
import styles from "./styles.module.css";

export type MarkKind = "user" | "tracked";
/** Lines dropdown groups. Aggregates marks into a single avg-price line
 *  per (kind, side). Position/order decorations are NOT separate toggles
 *  — they ride the `user` entry, since they are by definition tied to
 *  the user's wallets. */
export type LineKind = "user" | "tracked";
/** Per-mark event flavor.
 *  - "fill" / "liquidation": ride the `user`/`tracked` Marks toggle of
 *    the underlying signer; differ only in color + label.
 *  - "entry": persistent pin for an open position (one per position),
 *    distinct from the per-fill pins so the user can scan the chart
 *    and instantly see where they currently are.
 *  - "limit" / "tp" / "sl": open-order placement pins; ride the `user`
 *    toggle since they are always wallet-derived. */
export type MarkEvent = "fill" | "liquidation" | "entry" | "limit" | "tp" | "sl";

export interface PerpTradeMark {
  id: string;
  /** unix ms */
  time: number;
  kind: MarkKind;
  side: "buy" | "sell";
  /** Defaults to "fill". "liquidation" overrides color/label and excludes
   *  the row from the weighted-avg horizontal line. */
  event?: MarkEvent;
  label?: string;
  text?: string;
  /** USD price (chart axis units) — used for the weighted-avg horizontal line. */
  price?: number;
  /** USD notional of the fill — weight in the weighted avg. Trades with no
   *  positive size are excluded from the average. */
  sizeUsd?: number;
}

/** Standalone horizontal line tied to a real entity (open position, open
 *  order). One shape per decoration; not aggregated. The Lines dropdown
 *  toggles them as a group via `group`. */
export type DecorationKind = "entry" | "liq" | "limit" | "tp" | "sl";
export interface PerpDecoration {
  /** Stable per-entity (e.g. `<position_pubkey>:entry`). Drives the diff
   *  in the painter, so a position whose entry shifts due to a partial
   *  add stays the same shape and is just nudged via setPoints. */
  id: string;
  kind: DecorationKind;
  /** Toggle group — drives which Lines dropdown entry shows/hides it. */
  group: "positions" | "orders";
  /** USD price (chart axis units). */
  price: number;
  /** Label shown to the right of the line. Caller composes whatever
   *  context is useful (size, leverage, side, etc). */
  label: string;
  /** Side hint, used to color entry lines green (long) vs red (short).
   *  Liq/Limit/TP/SL ignore this and use their kind color. */
  side?: "long" | "short";
}

interface Props {
  /** market_id like "jup:SOL-PERP". */
  marketId: string | null;
  interval?: ResolutionString;
  theme?: ThemeName;
  /** Trade marks to render on the chart, filterable via the toolbar dropdown. */
  marks?: PerpTradeMark[];
  /** Open-position / open-order horizontal lines. Each entry becomes one
   *  shape on the chart, toggleable via the Lines dropdown's "My
   *  Positions" / "My Orders" entries. */
  decorations?: PerpDecoration[];
  /** Called when the user drags a tp or sl decoration line to a new price.
   *  `id` is the decoration id; `newPrice` is the dragged USD price. */
  onDecorationDrag?: (id: string, newPrice: number) => void;
  /** Current visibility of the orderbook/trades column to the right of the
   *  chart. Drives the toolbar toggle's icon. */
  rightPanelVisible?: boolean;
  /** Toggle the right-of-chart column. Mounting the toolbar button is gated on
   *  this being provided. */
  onToggleRightPanel?: () => void;
}

const INTERVAL_STORAGE_KEY = "perptvchart:interval";
const MARKS_ENABLED_KEY = "perptvchart:marks.enabled.v1";
// Bumped to v2 when "positions" / "orders" entries were added so existing
// users see them enabled by default.
const LINES_ENABLED_KEY = "perptvchart:lines.enabled.v2";
const SUPPORTED_INTERVALS = new Set<string>(["1", "5", "15", "60", "240", "1D"]);

const MARK_KINDS: MarkKind[] = ["user", "tracked"];
const MARK_LABELS: Record<MarkKind, string> = {
  user: "My wallets",
  tracked: "Tracked wallets",
};
const MARK_COLORS: Record<MarkKind, string> = {
  user: "#66d89e",    // green — own wallets
  tracked: "#8ab4ff", // blue — watchlist
};
const SELL_COLOR = "#e57359";
const BUY_COLOR  = "#66d89e";
// Liquidation pins paint in this gold regardless of side; toggle inherits
// from the parent `user`/`tracked` kind (no separate dropdown entry).
const LIQ_COLOR  = "#facc15";
// Open-order line colors. Limit = info blue, TP = candle green, SL = red.
const LIMIT_COLOR = "#8ab4ff";

const LINE_KINDS: LineKind[] = ["user", "tracked"];
const LINE_LABELS: Record<LineKind, string> = {
  user: "My Wallets",
  tracked: "Tracked Wallets",
};

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
  try { window.localStorage.setItem(LINES_ENABLED_KEY, JSON.stringify([...set])); }
  catch { /* ignore */ }
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
  try { window.localStorage.setItem(MARKS_ENABLED_KEY, JSON.stringify([...set])); }
  catch { /* ignore */ }
}

function readStoredInterval(fallback: ResolutionString): ResolutionString {
  if (typeof window === "undefined") return fallback;
  try {
    const saved = window.localStorage.getItem(INTERVAL_STORAGE_KEY);
    if (saved && SUPPORTED_INTERVALS.has(saved)) return saved as ResolutionString;
  } catch { /* ignore */ }
  return fallback;
}

const DRAG_SETTLE_MS = 12_000;
/** Decoration kinds that should be user-draggable (tp / sl). */
const DRAGGABLE_DEC_KINDS = new Set<DecorationKind>(["tp", "sl"]);

export const PerpTVChart = memo(function PerpTVChart({
  marketId,
  interval = "1" as ResolutionString,
  theme = "dark" as ThemeName,
  marks,
  decorations,
  onDecorationDrag,
  rightPanelVisible,
  onToggleRightPanel,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef    = useRef<IChartingLibraryWidget | null>(null);

  // Marks/lines state — held in refs so the datafeed provider and painter
  // always read current values without re-mounting the widget.
  const enabledKindsRef = useRef<Set<MarkKind>>(readStoredMarkKinds());
  const marksRef = useRef<PerpTradeMark[]>(marks ?? []);
  const prevMarkIdsRef = useRef<Set<string>>(new Set());
  const enabledLinesRef = useRef<Set<LineKind>>(readStoredLineKinds());
  const lineAdaptersRef = useRef<Map<string, { line: ITradingLineAdapter; price: number }>>(new Map());
  const pendingLinesRef = useRef<Set<string>>(new Set());
  const paintLinesRef = useRef<() => void>(() => {});
  const decDragSettleRef = useRef<Map<string, number>>(new Map());
  const onDecorationDragRef = useRef<((id: string, newPrice: number) => void) | undefined>(undefined);
  useEffect(() => { onDecorationDragRef.current = onDecorationDrag; }, [onDecorationDrag]);

  // Right-panel toggle — refs so the toolbar button reads current values
  // without re-mounting the widget. `paintRightPanelBtnRef` refreshes the icon
  // when the visibility prop changes.
  const onToggleRightPanelRef = useRef(onToggleRightPanel);
  const rightPanelVisibleRef = useRef<boolean>(rightPanelVisible ?? true);
  const paintRightPanelBtnRef = useRef<() => void>(() => {});
  useEffect(() => { onToggleRightPanelRef.current = onToggleRightPanel; }, [onToggleRightPanel]);
  useEffect(() => {
    rightPanelVisibleRef.current = rightPanelVisible ?? true;
    paintRightPanelBtnRef.current();
  }, [rightPanelVisible]);
  // Decorations (open positions / open orders). Re-painted on prop change
  // via the same `paintLinesRef.current()` machinery — entries become
  // keys in `lineAdaptersRef` so the diff naturally tracks them.
  const decorationsRef = useRef<PerpDecoration[]>(decorations ?? []);
  useEffect(() => {
    decorationsRef.current = decorations ?? [];
    paintLinesRef.current();
  }, [decorations]);

  useEffect(() => {
    const nextMarks = marks ?? [];
    marksRef.current = nextMarks;

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
      if (chart) {
        if (removed) chart.clearMarks();
        if (added || removed) chart.refreshMarks();
      }
    } catch { /* chart not ready */ }
    paintLinesRef.current();
  }, [marks]);

  useEffect(() => {
    if (!marketId || !containerRef.current) {
      widgetRef.current?.remove();
      widgetRef.current = null;
      return;
    }

    widgetRef.current?.remove();
    widgetRef.current = null;

    const datafeed = getPerpDatafeedInstance();

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
        const event = m.event ?? "fill";
        if (event === "entry") continue; // entry horizontal line already shows position level
        const KIND_LETTER: Partial<Record<MarkKind, string>> = { tracked: "T" };
        const letter = KIND_LETTER[m.kind];
        // Color/label per event flavor. Fills use buy/sell candle colors;
        // tracked fills carry a "T" letter so they stay visually distinct
        // from user pins. Liquidation pins are gold with an "L". Order
        // pins use the order-kind color (limit blue, TP green, SL red)
        // with a multi-char label since single letters would clash with
        // tracked "T" / liquidation "L".
        let color: string;
        let label: string;
        let text: string;
        if (event === "liquidation") {
          color = LIQ_COLOR;
          label = m.label ?? "L";
          text = m.text ?? `Liquidation (${MARK_LABELS[m.kind]}) · ${m.side.toUpperCase()}`;
        } else if (event === "limit") {
          color = LIMIT_COLOR;
          label = m.label ?? "Lim";
          text = m.text ?? `Limit order · ${m.side.toUpperCase()}`;
        } else if (event === "tp") {
          color = BUY_COLOR;
          label = m.label ?? "TP";
          text = m.text ?? `Take Profit · ${m.side.toUpperCase()}`;
        } else if (event === "sl") {
          color = SELL_COLOR;
          label = m.label ?? "SL";
          text = m.text ?? `Stop Loss · ${m.side.toUpperCase()}`;
        } else {
          // fill
          color = m.side === "sell"
            ? SELL_COLOR
            : letter
              ? BUY_COLOR
              : MARK_COLORS[m.kind];
          label = m.label ?? (letter ?? (m.side === "buy" ? "B" : "S"));
          text = m.text ?? `${MARK_LABELS[m.kind]} · ${m.side.toUpperCase()}`;
        }
        out.push({
          id: m.id,
          time: Math.floor(m.time / 1000),
          color: { border: color, background: color },
          text,
          label,
          labelFontColor: "#181615",
          minSize: 16,
        });
      }
      return out;
    });

    const ChartWidget = razeWidgetCtor();
    const tvWidget = new ChartWidget(razeChartOptions({
      symbol: marketId,
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
      favorites: { intervals: PERP_CHART_INTERVALS },
      raze: {
        aria_label: `${marketId} perpetual chart`,
        aria_description: "Live perpetual candles with fills, positions, and order lines.",
      },
    }));
    widgetRef.current = tvWidget;

    tvWidget.onChartReady(() => {
      const chart = tvWidget.activeChart();
      chart.onIntervalChanged().subscribe(null, (next: ResolutionString) => {
        try { window.localStorage.setItem(INTERVAL_STORAGE_KEY, next); }
        catch { /* ignore */ }
      });

      type LinePaintSpec = {
        price: number;
        color: string;
        label: string;
        primitive: "order" | "position";
        side: "buy" | "sell";
        editable: boolean;
      };

      const buildDesired = (): Map<string, LinePaintSpec> => {
        const enabled = enabledLinesRef.current;
        const desired = new Map<string, LinePaintSpec>();

        const wantUserDecorations = enabled.has("user");
        for (const d of decorationsRef.current) {
          if (!wantUserDecorations) continue;
          if (typeof d.price !== "number" || !Number.isFinite(d.price) || d.price <= 0) continue;
          const color =
            d.kind === "liq" ? LIQ_COLOR
            : d.kind === "limit" ? LIMIT_COLOR
            : d.kind === "tp" ? BUY_COLOR
            : d.kind === "sl" ? SELL_COLOR
            : d.side === "short" ? SELL_COLOR : BUY_COLOR;
          desired.set(d.id, {
            price: d.price,
            color,
            label: d.label,
            primitive: d.kind === "entry" || d.kind === "liq" ? "position" : "order",
            side: d.side === "short" ? "sell" : "buy",
            editable: DRAGGABLE_DEC_KINDS.has(d.kind),
          });
        }

        return desired;
      };

      const onTradingChange = (decId: string, event: TradingLineEvent) => {
        if (event.reason === "api") return;
        if (event.type !== "moved") return;
        const newPrice = event.line.price;
        if (!Number.isFinite(newPrice) || newPrice <= 0) return;
        decDragSettleRef.current.set(decId, Date.now() + DRAG_SETTLE_MS);
        const tracked = lineAdaptersRef.current.get(decId);
        if (tracked) tracked.price = newPrice;
        onDecorationDragRef.current?.(decId, newPrice);
      };

      paintLinesRef.current = () => {
        const desired = buildDesired();
        const nowMs = Date.now();

        for (const [key, entry] of lineAdaptersRef.current) {
          if (desired.has(key)) continue;
          try { entry.line.remove(); } catch { /* ignore */ }
          lineAdaptersRef.current.delete(key);
        }

        for (const [key, spec] of desired) {
          const existing = lineAdaptersRef.current.get(key);
          if (existing) {
            const settle = decDragSettleRef.current.get(key);
            if (settle && nowMs < settle) continue;
            try {
              if (existing.price !== spec.price) {
                existing.line.setPrice(spec.price);
                existing.price = spec.price;
              }
              existing.line.setText(spec.label);
            } catch {
              try { existing.line.remove(); } catch { /* ignore */ }
              lineAdaptersRef.current.delete(key);
            }
            if (lineAdaptersRef.current.has(key)) continue;
          }
          if (pendingLinesRef.current.has(key)) continue;
          const options = {
            id: key,
            side: spec.side,
            price: spec.price,
            text: spec.label,
            lineColor: spec.color,
            bodyBackgroundColor: spec.color,
            bodyTextColor: "#181615",
            editable: spec.editable,
            includeInAutoScale: true,
            status: spec.editable ? "working" as const : "filled" as const,
            onChange: (event: TradingLineEvent) => onTradingChange(key, event),
          };
          let promise: Promise<ITradingLineAdapter> | undefined;
          try {
            promise = spec.primitive === "position"
              ? chart.createPositionLine(options)
              : chart.createOrderLine(options);
          } catch {
            const recovered = chart.getTradingLineById(key);
            if (recovered) lineAdaptersRef.current.set(key, { line: recovered, price: spec.price });
          }
          if (promise) {
            const pendingKey = key;
            pendingLinesRef.current.add(pendingKey);
            promise.then((line) => {
              pendingLinesRef.current.delete(pendingKey);
              if (!line) return;
              if (!buildDesired().has(pendingKey)) {
                try { line.remove(); } catch { /* ignore */ }
                return;
              }
              lineAdaptersRef.current.set(pendingKey, { line, price: spec.price });
            }).catch(() => {
              pendingLinesRef.current.delete(pendingKey);
              const recovered = chart.getTradingLineById(pendingKey);
              if (recovered && buildDesired().has(pendingKey)) {
                lineAdaptersRef.current.set(pendingKey, { line: recovered, price: spec.price });
              }
            });
          }
        }
      };

      paintLinesRef.current();
    });

    void tvWidget.headerReady().then(() => {
      applyRazeChartChrome(tvWidget);

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

      mountMarksButton(tvWidget, enabledKindsRef, tvBtnCss);
      mountLinesButton(tvWidget, enabledLinesRef, tvBtnCss, paintLinesRef);
      if (onToggleRightPanelRef.current) {
        mountRightPanelToggleButton(
          tvWidget,
          tvBtnCss,
          () => rightPanelVisibleRef.current,
          () => onToggleRightPanelRef.current?.(),
          (paint) => { paintRightPanelBtnRef.current = paint; },
        );
      }

      try { tvWidget.activeChart().refreshMarks(); } catch { /* ignore */ }
    });

    return () => {
      widgetRef.current?.remove();
      widgetRef.current = null;
      lineAdaptersRef.current.clear();
      pendingLinesRef.current.clear();
      decDragSettleRef.current.clear();
      prevMarkIdsRef.current = new Set();
      paintLinesRef.current = () => {};
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId, theme]);

  useEffect(() => () => { destroyPerpDatafeedInstance(); }, []);

  if (!marketId) {
    return (
      <div className={styles.chart} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--paper-4)", fontSize: 13, fontStyle: "italic", fontFamily: "var(--font-dis)" }}>
          Select a market to view the chart
        </span>
      </div>
    );
  }

  return <div ref={containerRef} className={styles.chart} />;
});

// ── marks dropdown button ─────────────────────────────────────────────────────
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

      const swatch = document.createElement("span");
      swatch.style.cssText = "display:inline-flex;gap:3px;flex-shrink:0";
      swatch.innerHTML = [
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
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
      menu.style.display = "flex";
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

      // Each line kind shows two dashed swatches matching the on-chart
      // avg-buy (green) + avg-sell (red) lines. Position/order overlays
      // are bundled under "My Wallets" — they don't get their own swatch
      // since the toggle controls them transparently.
      const swatch = document.createElement("span");
      swatch.style.cssText = "display:inline-flex;flex-direction:column;gap:3px;flex-shrink:0";
      swatch.innerHTML = [
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
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
      menu.style.display = "flex";
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

// Toolbar buttons may live in a nested document; menus are mounted on the
// outer document, so translate iframe-local coordinates when needed.
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
