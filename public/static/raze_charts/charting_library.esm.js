// src/util/format.ts
function decimalsFromPricescale(pricescale) {
  if (!pricescale || pricescale <= 1) return 0;
  return Math.max(0, Math.round(Math.log10(pricescale)));
}
function formatPrice(value, pricescale) {
  if (!Number.isFinite(value)) return "";
  const decimals = decimalsFromPricescale(pricescale);
  if (decimals === 0) {
    return Math.round(value).toLocaleString("en-US");
  }
  const minFrac = Math.min(decimals, 2);
  const s = value.toLocaleString("en-US", { minimumFractionDigits: minFrac, maximumFractionDigits: decimals });
  return s;
}
function minTickOf(info) {
  if (!info || !info.pricescale) return "default";
  return String((info.minmov ?? 1) / info.pricescale);
}
function wrapCustom(format) {
  return (value, pricescale) => {
    try {
      const s = format(value, pricescale);
      return typeof s === "string" ? s : formatPrice(value, pricescale);
    } catch {
      return formatPrice(value, pricescale);
    }
  };
}
function createPriceFormatter(options, symbolInfo) {
  const factory = options?.custom_formatters?.priceFormatterFactory;
  if (typeof factory === "function") {
    try {
      const result = factory(symbolInfo ?? null, minTickOf(symbolInfo));
      if (result && typeof result.format === "function") {
        const fmt = result.format.bind(result);
        return wrapCustom((value, pricescale) => {
          const s = fmt(value);
          return typeof s === "string" ? s : formatPrice(value, pricescale);
        });
      }
    } catch {
    }
  }
  const razeFn = options?.raze?.format_price;
  if (typeof razeFn === "function") {
    return wrapCustom(razeFn);
  }
  return formatPrice;
}
function formatCompact(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const units = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"]
  ];
  for (const [div, suffix] of units) {
    if (abs >= div) {
      const n = value / div;
      const s = Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2);
      return `${sign}${trimZeros(s)}${suffix}`;
    }
  }
  return value.toLocaleString("en-US");
}
function trimZeros(s) {
  if (!s.includes(".")) return s;
  return s.replace(/\.?0+$/, "");
}
function formatVolume(value) {
  if (!Number.isFinite(value) || value === 0) return "0";
  return formatCompact(value);
}

// src/core/context.ts
var FEATURE_DEFAULTS_ON = /* @__PURE__ */ new Set([
  "header_widget",
  "header_resolutions",
  "left_toolbar",
  "legend_widget",
  "scale_bar"
]);
function applySymbolInfo(ctx, info) {
  ctx.symbolInfo = info;
  ctx.formatPrice = createPriceFormatter(ctx.options, info);
}
function buildFeatureSet(opts) {
  const set = new Set(FEATURE_DEFAULTS_ON);
  for (const f of opts.enabled_features ?? []) set.add(f);
  for (const f of opts.disabled_features ?? []) set.delete(f);
  return set;
}

// src/core/theme.ts
function darkDefaults() {
  return {
    paneBackground: "#131722",
    vertGrid: "rgba(255,255,255,0.06)",
    horzGrid: "rgba(255,255,255,0.06)",
    crosshair: "rgba(255,255,255,0.3)",
    scaleText: "#9598a1",
    scaleBackground: "#131722",
    scaleLine: "#363a45",
    candleUp: "#26a69a",
    candleDown: "#ef5350",
    borderUp: "#26a69a",
    borderDown: "#ef5350",
    wickUp: "#26a69a",
    wickDown: "#ef5350",
    volUp: "rgba(38,166,154,0.5)",
    volDown: "rgba(239,83,80,0.5)",
    showPriceScaleCrosshairLabel: true,
    showTimeScaleCrosshairLabel: true
  };
}
function lightDefaults() {
  return {
    ...darkDefaults(),
    paneBackground: "#ffffff",
    vertGrid: "rgba(0,0,0,0.06)",
    horzGrid: "rgba(0,0,0,0.06)",
    crosshair: "rgba(0,0,0,0.3)",
    scaleText: "#131722",
    scaleBackground: "#ffffff",
    scaleLine: "#e0e3eb"
  };
}
function buildTheme(opts) {
  const theme = opts.theme === "light" ? lightDefaults() : darkDefaults();
  const o = opts.overrides ?? {};
  const s = (key) => {
    const v = o[key];
    return typeof v === "string" ? v : void 0;
  };
  const b = (key, fallback) => {
    const v = o[key];
    return typeof v === "boolean" ? v : fallback;
  };
  theme.paneBackground = s("paneProperties.background") ?? theme.paneBackground;
  theme.vertGrid = s("paneProperties.vertGridProperties.color") ?? theme.vertGrid;
  theme.horzGrid = s("paneProperties.horzGridProperties.color") ?? theme.horzGrid;
  theme.crosshair = s("paneProperties.crossHairProperties.color") ?? theme.crosshair;
  theme.scaleText = s("scalesProperties.textColor") ?? theme.scaleText;
  theme.scaleBackground = s("scalesProperties.backgroundColor") ?? theme.scaleBackground;
  theme.scaleLine = s("scalesProperties.lineColor") ?? theme.scaleLine;
  theme.showPriceScaleCrosshairLabel = b("scalesProperties.showPriceScaleCrosshairLabel", theme.showPriceScaleCrosshairLabel);
  theme.showTimeScaleCrosshairLabel = b("scalesProperties.showTimeScaleCrosshairLabel", theme.showTimeScaleCrosshairLabel);
  const cs = "mainSeriesProperties.candleStyle.";
  theme.candleUp = s(cs + "upColor") ?? theme.candleUp;
  theme.candleDown = s(cs + "downColor") ?? theme.candleDown;
  theme.borderUp = s(cs + "borderUpColor") ?? theme.borderUp;
  theme.borderDown = s(cs + "borderDownColor") ?? theme.borderDown;
  theme.wickUp = s(cs + "wickUpColor") ?? theme.wickUp;
  theme.wickDown = s(cs + "wickDownColor") ?? theme.wickDown;
  theme.lineColor = s("mainSeriesProperties.lineStyle.color") ?? s("mainSeriesProperties.areaStyle.linecolor") ?? theme.lineColor;
  theme.volUp = s("mainSeriesProperties.volumeStyle.upColor") ?? withAlpha(theme.candleUp, 0.5);
  theme.volDown = s("mainSeriesProperties.volumeStyle.downColor") ?? withAlpha(theme.candleDown, 0.5);
  return theme;
}
function parseHex(color) {
  const hex = color.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!hex) return null;
  let h = hex[1];
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}
function withAlpha(color, alpha) {
  const c = parseHex(color);
  if (c) return `rgba(${c.r},${c.g},${c.b},${alpha})`;
  return color.trim();
}
function isLightColor(color) {
  const c = parseHex(color);
  if (!c) return false;
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b > 160;
}

// src/util/delegate.ts
var Delegate = class {
  constructor() {
    this.listeners = [];
  }
  subscribe(obj, fn, once = false) {
    this.listeners.push({ obj, fn, once });
  }
  unsubscribe(obj, fn) {
    this.listeners = this.listeners.filter((l) => !(l.obj === obj && l.fn === fn));
  }
  unsubscribeAll(obj) {
    this.listeners = this.listeners.filter((l) => l.obj !== obj);
  }
  fire(...args) {
    const snapshot = this.listeners.slice();
    for (const l of snapshot) {
      try {
        l.fn(...args);
      } catch {
      }
      if (l.once) this.unsubscribe(l.obj, l.fn);
    }
  }
  hasListeners() {
    return this.listeners.length > 0;
  }
  destroy() {
    this.listeners = [];
  }
};

// src/util/resolution.ts
var MIN = 6e4;
var HOUR = 60 * MIN;
var DAY = 24 * HOUR;
function parseResolution(res) {
  const s = String(res).trim().toUpperCase();
  const m = s.match(/^(\d+)\s*([SDWM]?)$/);
  if (!m) {
    return { ms: MIN, kind: "minutes", amount: 1 };
  }
  const amount = Math.max(1, parseInt(m[1], 10) || 1);
  const unit = m[2] || "";
  switch (unit) {
    case "S":
      return { ms: amount * 1e3, kind: "seconds", amount };
    case "D":
      return { ms: amount * DAY, kind: "days", amount };
    case "W":
      return { ms: amount * 7 * DAY, kind: "weeks", amount };
    case "M":
      return { ms: amount * 30 * DAY, kind: "months", amount };
    default: {
      const ms = amount * MIN;
      return { ms, kind: amount >= 60 && amount % 60 === 0 ? "hours" : "minutes", amount };
    }
  }
}
function resolutionToMs(res) {
  return parseResolution(res).ms;
}
function floorToBar(timeMs, res) {
  const ms = resolutionToMs(res);
  return Math.floor(timeMs / ms) * ms;
}
function resolutionLabel(res) {
  const p = parseResolution(res);
  switch (p.kind) {
    case "seconds":
      return `${p.amount}s`;
    case "minutes":
      return `${p.amount}m`;
    case "hours":
      return `${p.amount / 60}h`;
    case "days":
      return `${p.amount}D`;
    case "weeks":
      return `${p.amount}W`;
    case "months":
      return `${p.amount}M`;
  }
}

// src/data/DataManager.ts
var guidCounter = 0;
var nextGuid = () => `raze_${++guidCounter}_${Math.floor(performance.now())}`;
var INITIAL_BARS = 1500;
var PAGE_BARS = 1e3;
var INITIAL_VISIBLE_BARS = 120;
var errorMessage = (reason) => {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string" && reason.trim()) return reason;
  return "unknown datafeed error";
};
var DataManager = class {
  constructor(context) {
    this.context = context;
    this.config = null;
    this.subGuid = null;
    this.destroyed = false;
    /** Invalidates every callback belonging to an older data target. */
    this.generation = 0;
    /** Logical cancellation for callback-only datafeeds. */
    this.pendingCancellations = /* @__PURE__ */ new Set();
    this.latestReload = null;
    /** A request id avoids an old pagination finally-block unlocking a new one. */
    this.historyRequestId = 0;
    this.activeHistoryRequestId = null;
    /** Marks have their own revision so refresh/clear can supersede one another. */
    this.marksRequestId = 0;
    this.marksCancellation = null;
    /** False once the datafeed reports `noData` for older history. */
    this.hasMoreHistory = true;
    this.readySettled = false;
    this.desiredTarget = {
      symbol: this.context.symbol,
      resolution: this.context.resolution
    };
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      try {
        this.context.datafeed.onReady((cfg) => {
          if (!this.destroyed) this.config = cfg ?? {};
          this.settleReady();
        });
      } catch (error) {
        this.readySettled = true;
        reject(new Error(`[raze-charts] datafeed onReady failed: ${errorMessage(error)}`));
      }
    });
  }
  settleReady() {
    if (this.readySettled) return;
    this.readySettled = true;
    this.readyResolve();
  }
  ready() {
    return this.readyPromise;
  }
  getConfig() {
    return this.config;
  }
  isCurrent(generation) {
    return !this.destroyed && generation === this.generation;
  }
  cancelPending() {
    const pending = Array.from(this.pendingCancellations);
    this.pendingCancellations.clear();
    for (const cancel of pending) cancel();
    this.marksCancellation = null;
  }
  beginReload(target) {
    this.generation += 1;
    this.desiredTarget = target;
    this.stopLiveSubscription();
    this.cancelPending();
    this.marksRequestId += 1;
    this.historyRequestId += 1;
    this.activeHistoryRequestId = null;
    this.hasMoreHistory = true;
    return this.generation;
  }
  // -- Symbol resolution + initial load -------------------------------------
  async resolveAndLoad() {
    const first = this.startReload(
      { symbol: this.context.symbol, resolution: this.context.resolution },
      true
    );
    let pending = first;
    while (!this.destroyed) {
      try {
        await pending;
      } catch (error) {
        if (!this.latestReload || this.latestReload === pending) throw error;
      }
      const latest = this.latestReload;
      if (!latest || latest === pending) return;
      pending = latest;
    }
  }
  startReload(target, forceResolve = false) {
    if (this.destroyed) return Promise.resolve(false);
    const generation = this.beginReload(target);
    let tracked;
    tracked = this.performReload(generation, target, forceResolve).finally(() => {
      if (this.latestReload === tracked) this.latestReload = null;
    });
    this.latestReload = tracked;
    return tracked;
  }
  async performReload(generation, target, forceResolve) {
    try {
      await this.ready();
      if (!this.isCurrent(generation)) return false;
      let info = null;
      if (!forceResolve && target.symbol === this.context.symbol) {
        info = this.context.symbolInfo;
      }
      if (!info) info = await this.resolveSymbol(target.symbol, generation);
      if (!info || !this.isCurrent(generation)) return false;
      const resMs = resolutionToMs(target.resolution);
      const nowSec = Math.floor(Date.now() / 1e3);
      const fromSec = nowSec - Math.ceil(INITIAL_BARS * resMs / 1e3);
      const history = await this.requestBars(
        info,
        target.resolution,
        { from: fromSec, to: nowSec, countBack: INITIAL_BARS, firstDataRequest: true },
        generation
      );
      if (!history || !this.isCurrent(generation)) return false;
      this.context.symbol = target.symbol;
      this.context.resolution = target.resolution;
      applySymbolInfo(this.context, info);
      this.context.bars = this.normaliseBars(history.bars);
      this.context.marks = [];
      this.hasMoreHistory = !(history.noData && history.bars.length === 0);
      this.initVisibleRange();
      this.startLiveSubscription(generation, info, target.resolution);
      this.context.dataChanged.fire();
      this.context.requestPaint();
      this.refreshMarksFor(generation, info, target.resolution, this.context.bars);
      return true;
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.desiredTarget = {
          symbol: this.context.symbol,
          resolution: this.context.resolution
        };
        if (this.context.symbolInfo) {
          this.startLiveSubscription(
            generation,
            this.context.symbolInfo,
            this.context.resolution
          );
        }
      }
      throw error;
    }
  }
  resolveSymbol(symbol, generation) {
    return new Promise((resolve, reject) => {
      if (!this.isCurrent(generation)) {
        resolve(null);
        return;
      }
      let settled = false;
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        this.pendingCancellations.delete(cancel);
        if (error !== void 0 && this.isCurrent(generation)) {
          reject(new Error(
            `[raze-charts] resolveSymbol failed for "${symbol}": ${errorMessage(error)}`
          ));
        } else {
          resolve(this.isCurrent(generation) ? value : null);
        }
      };
      const cancel = () => finish(null);
      this.pendingCancellations.add(cancel);
      try {
        this.context.datafeed.resolveSymbol(
          symbol,
          (info) => finish(info),
          (reason) => finish(null, reason)
        );
      } catch (error) {
        finish(null, error);
      }
    });
  }
  /** Position the initial visible window over the most recent ~120 bar slots. */
  initVisibleRange() {
    const n = this.context.bars.length;
    if (n === 0) {
      this.context.visibleRange = { from: 0, to: 1 };
      return;
    }
    const visibleCount = INITIAL_VISIBLE_BARS;
    const rightPad = Math.min(8, Math.max(1, Math.round(visibleCount * 0.06)));
    this.context.visibleRange = {
      from: n - visibleCount,
      to: n - 1 + rightPad
    };
    this.context.autoScalePrice = true;
  }
  // -- Lazy left-scroll pagination -----------------------------------------
  /** Called by the engine when the visible range nears the left edge. */
  async maybeLoadMoreHistory() {
    if (this.destroyed || this.activeHistoryRequestId !== null || !this.hasMoreHistory) return;
    const bars = this.context.bars;
    const info = this.context.symbolInfo;
    if (!bars.length || !info) return;
    if (this.context.visibleRange.from > 50) return;
    const generation = this.generation;
    const resolution = this.context.resolution;
    const requestId = ++this.historyRequestId;
    this.activeHistoryRequestId = requestId;
    try {
      const oldestMs = bars[0].time;
      const resMs = resolutionToMs(resolution);
      const toSec = Math.floor(oldestMs / 1e3) - 1;
      const fromSec = toSec - Math.ceil(PAGE_BARS * resMs / 1e3);
      const history = await this.requestBars(
        info,
        resolution,
        { from: fromSec, to: toSec, countBack: PAGE_BARS, firstDataRequest: false },
        generation
      );
      if (!history || !this.isCurrent(generation) || this.activeHistoryRequestId !== requestId) {
        return;
      }
      if (!history.bars.length) {
        this.hasMoreHistory = false;
      } else {
        const before = this.context.bars.length;
        this.mergeBars(history.bars);
        const addedCount = this.context.bars.length - before;
        if (addedCount > 0) {
          this.context.visibleRange = {
            from: this.context.visibleRange.from + addedCount,
            to: this.context.visibleRange.to + addedCount
          };
        }
      }
      this.context.dataChanged.fire();
      this.context.requestPaint();
    } catch (error) {
      if (this.isCurrent(generation)) this.reportError("history pagination", error);
    } finally {
      if (this.activeHistoryRequestId === requestId) this.activeHistoryRequestId = null;
    }
  }
  requestBars(info, resolution, periodParams, generation) {
    return new Promise((resolve, reject) => {
      if (!this.isCurrent(generation)) {
        resolve(null);
        return;
      }
      let settled = false;
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        this.pendingCancellations.delete(cancel);
        if (error !== void 0 && this.isCurrent(generation)) {
          reject(new Error(
            `[raze-charts] getBars failed for "${info.name}" at ${resolution}: ${errorMessage(error)}`
          ));
        } else {
          resolve(this.isCurrent(generation) ? value : null);
        }
      };
      const cancel = () => finish(null);
      this.pendingCancellations.add(cancel);
      try {
        this.context.datafeed.getBars(
          info,
          resolution,
          periodParams,
          (bars, meta) => {
            const safeBars = Array.isArray(bars) ? bars : [];
            finish({ bars: safeBars, noData: meta?.noData === true });
          },
          (reason) => finish(null, reason)
        );
      } catch (error) {
        finish(null, error);
      }
    });
  }
  /** Merge a batch into the canonical series, dedup by time, keep ascending. */
  mergeBars(batch) {
    this.context.bars = this.normaliseBars([...this.context.bars, ...batch]);
  }
  normaliseBars(batch) {
    const byTime = /* @__PURE__ */ new Map();
    for (const bar of batch) {
      if (!bar || !Number.isFinite(bar.time)) continue;
      byTime.set(bar.time, bar);
    }
    return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
  }
  // -- Live subscription ----------------------------------------------------
  startLiveSubscription(generation, info, resolution) {
    this.stopLiveSubscription();
    if (!this.isCurrent(generation)) return;
    const guid = nextGuid();
    this.subGuid = guid;
    try {
      this.context.datafeed.subscribeBars(
        info,
        resolution,
        (bar) => {
          if (!this.isCurrent(generation) || this.subGuid !== guid) return;
          this.onLiveBar(bar);
        },
        guid,
        () => {
          queueMicrotask(() => {
            if (!this.isCurrent(generation) || this.subGuid !== guid) return;
            this.resetData();
          });
        }
      );
    } catch (error) {
      if (this.subGuid === guid) this.subGuid = null;
      if (this.isCurrent(generation)) this.reportError("live subscription", error);
    }
  }
  stopLiveSubscription() {
    const guid = this.subGuid;
    this.subGuid = null;
    if (!guid) return;
    try {
      this.context.datafeed.unsubscribeBars(guid);
    } catch {
    }
  }
  onLiveBar(bar) {
    if (!Number.isFinite(bar.time)) return;
    const bars = this.context.bars;
    const last = bars[bars.length - 1];
    const pinnedRight = bars.length > 0 && this.context.visibleRange.to >= bars.length - 1;
    if (last && bar.time === last.time) {
      bars[bars.length - 1] = bar;
    } else if (!last || bar.time > last.time) {
      bars.push(bar);
      if (pinnedRight) {
        this.context.visibleRange = {
          from: this.context.visibleRange.from + 1,
          to: this.context.visibleRange.to + 1
        };
      }
    } else {
      return;
    }
    this.context.dataChanged.fire();
    this.context.requestPaint();
  }
  // -- Marks ---------------------------------------------------------------
  cancelMarksRequest() {
    this.marksRequestId += 1;
    const cancel = this.marksCancellation;
    this.marksCancellation = null;
    cancel?.();
  }
  requestMarks(generation, requestId, info, resolution, from, to) {
    return new Promise((resolve, reject) => {
      if (!this.isCurrent(generation) || requestId !== this.marksRequestId) {
        resolve(null);
        return;
      }
      let settled = false;
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        this.pendingCancellations.delete(cancel);
        if (this.marksCancellation === cancel) this.marksCancellation = null;
        if (error !== void 0 && this.isCurrent(generation) && requestId === this.marksRequestId) {
          reject(new Error(
            `[raze-charts] getMarks failed for "${info.name}" at ${resolution}: ${errorMessage(error)}`
          ));
        } else {
          resolve(
            this.isCurrent(generation) && requestId === this.marksRequestId ? value : null
          );
        }
      };
      const cancel = () => finish(null);
      this.pendingCancellations.add(cancel);
      this.marksCancellation = cancel;
      try {
        this.context.datafeed.getMarks(
          info,
          from,
          to,
          (marks) => finish(Array.isArray(marks) ? marks : []),
          resolution
        );
      } catch (error) {
        finish(null, error);
      }
    });
  }
  async loadMarksFor(generation, info, resolution, bars) {
    this.cancelMarksRequest();
    const requestId = this.marksRequestId;
    const getMarks = this.context.datafeed.getMarks;
    if (!info || typeof getMarks !== "function" || !bars.length) {
      if (this.isCurrent(generation) && requestId === this.marksRequestId) {
        this.context.marks = [];
        return true;
      }
      return false;
    }
    const from = Math.floor(bars[0].time / 1e3);
    const to = Math.floor(bars[bars.length - 1].time / 1e3) + 86400;
    const marks = await this.requestMarks(
      generation,
      requestId,
      info,
      resolution,
      from,
      to
    );
    if (marks === null || !this.isCurrent(generation) || requestId !== this.marksRequestId) {
      return false;
    }
    this.context.marks = marks;
    return true;
  }
  async loadMarks() {
    await this.loadMarksFor(
      this.generation,
      this.context.symbolInfo,
      this.context.resolution,
      this.context.bars
    );
  }
  refreshMarksFor(generation, info, resolution, bars) {
    void this.loadMarksFor(generation, info, resolution, bars).then((changed) => {
      if (!changed || !this.isCurrent(generation)) return;
      this.context.dataChanged.fire();
      this.context.requestPaint();
    }).catch((error) => {
      if (this.isCurrent(generation)) this.reportError("marks request", error);
    });
  }
  refreshMarks() {
    this.refreshMarksFor(
      this.generation,
      this.context.symbolInfo,
      this.context.resolution,
      this.context.bars
    );
  }
  clearMarks() {
    if (this.destroyed) return;
    this.cancelMarksRequest();
    this.context.marks = [];
    this.context.dataChanged.fire();
    this.context.requestPaint();
  }
  // -- Resolution / symbol changes -----------------------------------------
  async changeResolution(resolution) {
    const target = { symbol: this.desiredTarget.symbol, resolution };
    if (target.symbol === this.desiredTarget.symbol && target.resolution === this.desiredTarget.resolution) {
      if (this.latestReload) await this.latestReload;
      return;
    }
    const previous = this.context.resolution;
    const changed = await this.startReload(target);
    if (changed && previous !== resolution && !this.destroyed) {
      const timeframe = {};
      this.context.intervalChanged.fire(resolution, timeframe);
    }
  }
  async changeSymbol(symbol, resolution = this.desiredTarget.resolution) {
    const target = { symbol, resolution };
    if (target.symbol === this.desiredTarget.symbol && target.resolution === this.desiredTarget.resolution) {
      if (this.latestReload) await this.latestReload;
      return;
    }
    const previousResolution = this.context.resolution;
    const changed = await this.startReload(target);
    if (changed && previousResolution !== resolution && !this.destroyed) {
      const timeframe = {};
      this.context.intervalChanged.fire(resolution, timeframe);
    }
  }
  resetData() {
    if (this.destroyed) return;
    const target = { ...this.desiredTarget };
    void this.startReload(target).catch((error) => {
      if (!this.destroyed) this.reportError("data reset", error);
    });
  }
  reportError(operation, error) {
    console.error(`[raze-charts] ${operation} failed`, error);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    this.historyRequestId += 1;
    this.activeHistoryRequestId = null;
    this.marksRequestId += 1;
    this.stopLiveSubscription();
    this.cancelPending();
    this.latestReload = null;
    this.settleReady();
  }
};

// src/core/ShapeStore.ts
var shapeCounter = 0;
var nextId = () => `shape_${++shapeCounter}`;
var ShapeStore = class {
  constructor(context) {
    this.context = context;
    this.shapes = /* @__PURE__ */ new Map();
  }
  create(point, options) {
    return this.createPoints([point], options);
  }
  createPoints(points, options) {
    const id = nextId();
    const stored = {
      id,
      shape: options.shape ?? "horizontal_line",
      points: points.map((p) => ({ ...p })),
      text: options.text ?? "",
      lock: options.lock ?? false,
      disableSelection: options.disableSelection ?? false,
      zOrder: options.zOrder === "top" ? "top" : "bottom",
      overrides: { ...options.overrides }
    };
    this.shapes.set(id, stored);
    this.context.requestPaint();
    this.context.drawingEvent.fire(id, "create");
    return Promise.resolve(id);
  }
  remove(id) {
    if (this.shapes.delete(id)) {
      if (this.context.selectedShapeId === id) {
        this.context.selectedShapeId = null;
      }
      this.context.drawingEvent.fire(id, "remove");
      this.context.requestPaint();
    }
  }
  removeAll() {
    if (this.shapes.size) {
      this.shapes.clear();
      this.context.selectedShapeId = null;
      this.context.requestPaint();
    }
  }
  get(id) {
    return this.shapes.get(id);
  }
  list() {
    return Array.from(this.shapes.values()).sort(
      (a, b) => (a.zOrder === "top" ? 1 : 0) - (b.zOrder === "top" ? 1 : 0)
    );
  }
  adapter(id) {
    const store = this;
    return {
      getPoints() {
        const s = store.shapes.get(id);
        return s ? s.points.map((p) => ({ ...p })) : [];
      },
      setPoints(points) {
        const s = store.shapes.get(id);
        if (!s) return;
        s.points = points.map((p) => ({ ...p }));
        store.context.requestPaint();
      },
      setPriceLevel(price) {
        const s = store.shapes.get(id);
        if (!s || !s.points[0]) return;
        s.points[0].price = price;
        store.context.requestPaint();
      },
      bringToFront() {
        const s = store.shapes.get(id);
        if (s) s.zOrder = "top";
        store.context.requestPaint();
      },
      sendToBack() {
        const s = store.shapes.get(id);
        if (s) s.zOrder = "bottom";
        store.context.requestPaint();
      },
      getProperties() {
        return { ...store.shapes.get(id)?.overrides ?? {} };
      },
      setProperties(props) {
        const s = store.shapes.get(id);
        if (!s) return;
        Object.assign(s.overrides, props);
        store.context.requestPaint();
      }
    };
  }
};

// src/core/ChartApi.ts
var ChartApi = class {
  constructor(context, deps) {
    this.context = context;
    this.deps = deps;
    const d = context.intervalChanged;
    this.intervalSub = {
      subscribe: (obj, fn, once) => d.subscribe(obj, fn, once),
      unsubscribe: (obj, fn) => d.unsubscribe(obj, fn),
      unsubscribeAll: (obj) => d.unsubscribeAll(obj)
    };
  }
  resolution() {
    return this.context.resolution;
  }
  setResolution(resolution, callback) {
    this.deps.setResolution(resolution, callback);
  }
  onIntervalChanged() {
    return this.intervalSub;
  }
  symbol() {
    return this.context.symbol;
  }
  setSymbol(symbol, callback) {
    this.deps.setSymbol(symbol, callback);
  }
  getVisibleRange() {
    const bars = this.context.bars;
    const { from, to } = this.context.visibleRange;
    const idx = (i) => {
      const clamped = Math.max(0, Math.min(bars.length - 1, Math.round(i)));
      const bar = bars[clamped];
      return bar ? Math.floor(bar.time / 1e3) : 0;
    };
    return { from: idx(from), to: idx(to) };
  }
  setVisibleRange(range) {
    const bars = this.context.bars;
    if (bars.length) {
      const fromMs = range.from * 1e3;
      const toMs = range.to * 1e3;
      let fi = 0;
      let ti = bars.length - 1;
      for (let i = 0; i < bars.length; i++) {
        if (bars[i].time <= fromMs) fi = i;
        if (bars[i].time <= toMs) ti = i;
      }
      this.context.visibleRange = { from: fi, to: Math.max(fi + 1, ti) };
      this.context.autoScalePrice = true;
      this.context.requestPaint();
    }
    return Promise.resolve();
  }
  createShape(point, options) {
    return this.deps.createShape(point, options);
  }
  createMultipointShape(points, options) {
    return this.deps.createMultipointShape(points, options);
  }
  getShapeById(entityId) {
    return this.deps.getShapeById(entityId);
  }
  removeEntity(entityId) {
    this.deps.removeEntity(entityId);
  }
  removeAllShapes() {
    this.deps.removeAllShapes();
  }
  createStudy(name, forceOverlay, lock, inputs) {
    return this.deps.createStudy(name, forceOverlay, lock, inputs);
  }
  refreshMarks() {
    this.deps.refreshMarks();
  }
  clearMarks() {
    this.deps.clearMarks();
  }
  resetData() {
    this.deps.resetData();
  }
};

// src/engine/ChartEngine.ts
var ChartEngine = class {
  constructor(host, context) {
    this.host = host;
    this.context = context;
    this.ro = null;
    this.rafId = null;
    this.dirty = false;
    this.painting = false;
    this.destroyed = false;
    this.requestPaint = () => this.markDirty();
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.dpr = 1;
    /** Overridable paint hook; replaced/extended by the renderer in P2. */
    this.paintHook = null;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "raze-chart-canvas";
    this.canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
    this.canvas.tabIndex = 0;
    host.appendChild(this.canvas);
    const c2d = this.canvas.getContext("2d");
    if (!c2d) throw new Error("[raze-charts] 2D canvas context unavailable");
    this.ctx2d = c2d;
    const accessibilityId = ++chartAccessibilitySequence;
    this.accessibilityDescriptionId = `raze-chart-description-${accessibilityId}`;
    this.descriptionEl = createVisuallyHiddenElement();
    this.descriptionEl.id = this.accessibilityDescriptionId;
    this.descriptionEl.className = "raze-chart-a11y-description";
    host.appendChild(this.descriptionEl);
    this.statusEl = createVisuallyHiddenElement();
    this.statusEl.className = "raze-chart-a11y-status";
    this.statusEl.setAttribute("role", "status");
    this.statusEl.setAttribute("aria-live", "polite");
    this.statusEl.setAttribute("aria-atomic", "true");
    host.appendChild(this.statusEl);
    this.syncAccessibility();
    this.context.requestPaint = this.requestPaint;
    this.onWinResize = () => this.resize();
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(host);
    }
    window.addEventListener("resize", this.onWinResize);
    this.resize();
    this.markDirty();
  }
  markDirty() {
    if (this.destroyed) return;
    this.dirty = true;
    this.schedule();
  }
  /** Refreshes the accessible name after an imperative symbol change. */
  syncAccessibility() {
    const configuredLabel = this.context.options.raze?.aria_label?.trim();
    const configuredDescription = this.context.options.raze?.aria_description?.trim();
    const label = configuredLabel || `${this.context.symbol} financial chart`;
    const overview = configuredDescription || `Interactive price chart for ${this.context.symbol}.`;
    const description = `${overview} ${KEYBOARD_INSTRUCTIONS}`;
    this.canvas.setAttribute("role", "application");
    this.canvas.setAttribute("aria-roledescription", "interactive financial chart");
    this.canvas.setAttribute("aria-label", label);
    this.canvas.setAttribute("aria-describedby", this.accessibilityDescriptionId);
    this.canvas.setAttribute(
      "aria-keyshortcuts",
      "ArrowLeft ArrowRight + - F Escape Delete Backspace"
    );
    this.canvas.textContent = `${label}. ${description}`;
    this.descriptionEl.textContent = description;
  }
  /** Announces the result of a keyboard interaction without moving focus. */
  announce(message) {
    if (this.destroyed) return;
    this.statusEl.textContent = "";
    queueMicrotask(() => {
      if (!this.destroyed) this.statusEl.textContent = message;
    });
  }
  get accessibilityLabel() {
    return this.canvas.getAttribute("aria-label") ?? "Financial chart";
  }
  resize() {
    if (this.destroyed) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(0, Math.floor(this.host.clientWidth));
    const h = Math.max(0, Math.floor(this.host.clientHeight));
    if (w === this.cssWidth && h === this.cssHeight && dpr === this.dpr) return;
    this.cssWidth = w;
    this.cssHeight = h;
    this.dpr = dpr;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.markDirty();
  }
  schedule() {
    if (this.destroyed || this.painting || this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => this.onAnimationFrame());
  }
  onAnimationFrame() {
    this.rafId = null;
    if (this.destroyed || !this.dirty) return;
    this.dirty = false;
    this.painting = true;
    try {
      this.paint();
    } finally {
      this.painting = false;
      if (this.dirty) this.schedule();
    }
  }
  paint() {
    const ctx = this.ctx2d;
    const { dpr } = this;
    ctx.save();
    try {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
      ctx.fillStyle = this.context.theme.paneBackground;
      ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
      if (this.paintHook) this.paintHook(ctx);
    } finally {
      ctx.restore();
    }
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.dirty = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.ro?.disconnect();
    this.ro = null;
    window.removeEventListener("resize", this.onWinResize);
    if (this.context.requestPaint === this.requestPaint) {
      this.context.requestPaint = () => {
      };
    }
    this.descriptionEl.remove();
    this.statusEl.remove();
    this.canvas.remove();
  }
};
var chartAccessibilitySequence = 0;
var KEYBOARD_INSTRUCTIONS = "Keyboard controls: Left and Right Arrow pan, Plus and Minus zoom, F fits all data, Escape cancels drawing, and Delete or Backspace removes the selected drawing.";
function createVisuallyHiddenElement() {
  const el = document.createElement("div");
  el.style.cssText = [
    "position:absolute",
    "width:1px",
    "height:1px",
    "padding:0",
    "margin:-1px",
    "overflow:hidden",
    "clip:rect(0,0,0,0)",
    "white-space:nowrap",
    "border:0"
  ].join(";");
  return el;
}

// src/util/heikinAshi.ts
function heikinAshi(bars) {
  const out = [];
  let prevOpen = 0;
  let prevClose = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = i === 0 ? (b.open + b.close) / 2 : (prevOpen + prevClose) / 2;
    const high = Math.max(b.high, open, close);
    const low = Math.min(b.low > 0 ? b.low : Math.min(open, close), open, close);
    out.push({ time: b.time, open, high, low, close, volume: b.volume });
    prevOpen = open;
    prevClose = close;
  }
  return out;
}

// src/engine/layout.ts
var PRICE_AXIS_W_DEFAULT = 64;
var PRICE_AXIS_W_MIN = 56;
var PRICE_AXIS_W_MAX = 128;
var TIME_AXIS_H = 22;
var MIN_BAR_SPACING = 1.5;
var MAX_BAR_SPACING = 64;
var VOLUME_FRACTION = 0.16;
var SUB_PANE_FRACTION = 0.22;
var SUB_PANES_MAX_FRACTION = 0.45;
var SUB_PANE_GAP = 3;
var CANDLE_MAX_WIDTH = 18;
function computePlotLayout(cssWidth, cssHeight, priceAxisW, paneDefs) {
  const nPanes = paneDefs.length;
  const paneFrac = nPanes ? Math.min(SUB_PANE_FRACTION, SUB_PANES_MAX_FRACTION / nPanes) : 0;
  const paneH = nPanes ? Math.max(48, Math.floor(cssHeight * paneFrac)) : 0;
  const panesTotal = nPanes * (paneH + SUB_PANE_GAP);
  const plotL = 0;
  const plotT = 0;
  const plotW = Math.max(1, cssWidth - priceAxisW);
  const plotH = Math.max(1, cssHeight - TIME_AXIS_H - panesTotal);
  const subPanes = paneDefs.map((def, i) => ({
    def,
    top: plotT + plotH + SUB_PANE_GAP + i * (paneH + SUB_PANE_GAP),
    h: paneH,
    min: 0,
    max: 1
  }));
  return { plotL, plotT, plotW, plotH, subPanes };
}
function timeAxisTop(plotT, plotH, subPanes) {
  const last = subPanes[subPanes.length - 1];
  return last ? last.top + last.h : plotT + plotH;
}

// src/engine/plotScale.ts
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var SEC = 1e3;
var MIN_MS = 6e4;
var HR = 36e5;
var DAY_MS = 864e5;
var NICE_TIME_STEPS = [
  SEC,
  5 * SEC,
  15 * SEC,
  30 * SEC,
  MIN_MS,
  5 * MIN_MS,
  15 * MIN_MS,
  30 * MIN_MS,
  HR,
  2 * HR,
  3 * HR,
  6 * HR,
  12 * HR,
  DAY_MS,
  7 * DAY_MS,
  14 * DAY_MS,
  30 * DAY_MS,
  90 * DAY_MS,
  365 * DAY_MS
];
function barSpacing(s) {
  const span = s.visibleRange.to - s.visibleRange.from;
  if (span <= 0) return MAX_BAR_SPACING;
  return s.plotW / span;
}
function xForIndex(s, i) {
  return s.plotL + (i - s.visibleRange.from + 0.5) * barSpacing(s);
}
function indexForX(s, x) {
  return s.visibleRange.from + (x - s.plotL) / barSpacing(s) - 0.5;
}
function toDisplay(s, price) {
  if (s.percentScale) {
    return s.pctBase > 0 ? (price - s.pctBase) / s.pctBase * 100 : 0;
  }
  if (s.logScale) {
    return price > 0 ? Math.log10(price) : Math.log10(Number.MIN_VALUE);
  }
  return price;
}
function fromDisplay(s, d) {
  if (s.percentScale) {
    return s.pctBase * (1 + d / 100);
  }
  if (s.logScale) {
    return Math.pow(10, d);
  }
  return d;
}
function yForPrice(s, p) {
  const d = toDisplay(s, p);
  const r = s.priceMax - s.priceMin || 1;
  return s.plotT + (s.priceMax - d) / r * s.plotH;
}
function priceForY(s, y) {
  const r = s.priceMax - s.priceMin || 1;
  const d = s.priceMax - (y - s.plotT) / s.plotH * r;
  return fromDisplay(s, d);
}
function formatAxisPrice(s, price, pricescale) {
  if (s.percentScale) {
    const pct = toDisplay(s, price);
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct.toFixed(2)}%`;
  }
  const format = s.context?.formatPrice ?? formatPrice;
  return format(price, pricescale);
}
function computePriceTicks(s) {
  const target = Math.max(2, Math.floor(s.plotH / 56));
  const range = s.priceMax - s.priceMin;
  if (range <= 0) return [];
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-12))));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const first = Math.ceil(s.priceMin / step) * step;
  const ticks = [];
  for (let d = first; d <= s.priceMax; d += step) {
    ticks.push(fromDisplay(s, d));
  }
  return ticks;
}
function computeTimeTicks(bars, s) {
  if (!bars.length) return [];
  const { from, to } = s.visibleRange;
  const start = Math.max(0, Math.floor(from));
  const end = Math.min(bars.length - 1, Math.ceil(to));
  if (end < start) return [];
  const target = Math.max(2, Math.floor(s.plotW / 110));
  const spanMs = Math.max(1, bars[end].time - bars[start].time);
  const step = NICE_TIME_STEPS.find((t) => spanMs / t <= target) ?? NICE_TIME_STEPS[NICE_TIME_STEPS.length - 1];
  const ticks = [];
  let lastBucket = null;
  for (let i = start; i <= end; i++) {
    const bucket = Math.floor(bars[i].time / step);
    if (lastBucket === null || bucket !== lastBucket) {
      ticks.push({ index: i, time: bars[i].time });
      lastBucket = bucket;
    }
  }
  return ticks;
}
function formatAxisTime(ms, kind) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  const intraday = kind === "seconds" || kind === "minutes" || kind === "hours";
  if (intraday) {
    if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) {
      return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
    }
    if (kind === "seconds") {
      return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    }
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
function formatCrosshairTime(ms, kind) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;
  const intraday = kind === "seconds" || kind === "minutes" || kind === "hours";
  if (!intraday) return date;
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return kind === "seconds" ? `${date} ${hm}:${pad(d.getUTCSeconds())}` : `${date} ${hm}`;
}
function autoFitPriceRange(bars, s, autoScale, manual) {
  const { from, to } = s.visibleRange;
  const start = Math.max(0, Math.floor(from));
  const end = Math.min(bars.length - 1, Math.ceil(to));
  const baseBar = bars[start] ?? bars[0];
  const pctBase = baseBar && baseBar.close > 0 ? baseBar.close : 1;
  const scale = { ...s, pctBase };
  if (manual && !autoScale) {
    let priceMin2 = toDisplay(scale, manual.min);
    let priceMax2 = toDisplay(scale, manual.max);
    if (priceMin2 >= priceMax2) priceMax2 = priceMin2 + 1;
    return { priceMin: priceMin2, priceMax: priceMax2, pctBase };
  }
  let bodyHi = -Infinity;
  let bodyLo = Infinity;
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = start; i <= end; i++) {
    const b = bars[i];
    if (!b) continue;
    const c = b.close > 0 ? b.close : b.open;
    const bH = Math.max(b.open, c);
    const bL = Math.min(b.open, c);
    if (bH > bodyHi) bodyHi = bH;
    if (bL > 0 && bL < bodyLo) bodyLo = bL;
    if (b.high > hi) hi = b.high;
    const low = b.low > 0 ? b.low : bL;
    if (low > 0 && low < lo) lo = low;
  }
  if (!Number.isFinite(bodyHi) || !Number.isFinite(bodyLo) || bodyHi <= 0) {
    return { priceMin: 0, priceMax: 1, pctBase };
  }
  const bodyRange = Math.max(0, bodyHi - bodyLo);
  const wickRoom = Math.max(bodyRange, bodyHi * 0.06);
  hi = Math.min(hi, bodyHi + wickRoom);
  lo = Math.max(Math.max(0, bodyLo - wickRoom), Number.isFinite(lo) ? lo : bodyLo);
  if (lo >= hi) {
    lo = bodyLo * 0.99;
    hi = bodyHi * 1.01;
  }
  if (scale.logScale) {
    lo = Math.max(lo, hi * 1e-6, Number.MIN_VALUE);
  }
  const dHi = toDisplay(scale, hi);
  const dLo = toDisplay(scale, lo);
  const pad = (dHi - dLo) * 0.08;
  let priceMin = dLo - pad;
  let priceMax = dHi + pad;
  if (priceMin >= priceMax) priceMax = priceMin + 1;
  return { priceMin, priceMax, pctBase };
}

// src/engine/paint/primitives.ts
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  const anyCtx = ctx;
  if (typeof anyCtx.roundRect === "function") {
    anyCtx.roundRect(x, y, w, h, rr);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
function drawAxisTag(ctx, v, y, text, bg, fg, bold = false, clampTop = v.plotT, clampBot = v.plotT + v.plotH) {
  const x0 = v.plotL + v.plotW;
  const h = 16;
  const top = Math.max(clampTop, Math.min(clampBot - h, y - h / 2));
  ctx.fillStyle = bg;
  roundRect(ctx, x0 + 3, top, v.priceAxisW - 5, h, 3);
  ctx.fill();
  ctx.font = `${bold ? "600 " : ""}11px ${v.fontFamily}`;
  ctx.fillStyle = fg;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x0 + v.priceAxisW - 7, top + h / 2 + 0.5);
}
function timeAxisTopOf(v) {
  const last = v.subPanes[v.subPanes.length - 1];
  return last ? last.top + last.h : v.plotT + v.plotH;
}
function neutralPill(v) {
  return isLightColor(v.context.theme.paneBackground) ? { bg: "#131722", fg: "#ffffff" } : { bg: "#3a3833", fg: "#f4eee1" };
}

// src/engine/paint/axes.ts
function adjustPriceAxisWidth(ctx, v, ticks) {
  const pricescale = v.context.symbolInfo?.pricescale ?? 100;
  ctx.font = `11px ${v.fontFamily}`;
  let widest = 0;
  const consider = (val) => {
    const w = ctx.measureText(formatAxisPrice(v, val, pricescale)).width;
    if (w > widest) widest = w;
  };
  for (const p of ticks) consider(p);
  consider(fromDisplay(v, v.priceMax));
  consider(fromDisplay(v, v.priceMin));
  const last = v.context.bars[v.context.bars.length - 1];
  if (last) consider(last.close);
  return Math.round(Math.max(PRICE_AXIS_W_MIN, Math.min(PRICE_AXIS_W_MAX, widest + 16)));
}
function drawPriceAxis(ctx, v, ticks) {
  const t = v.context.theme;
  const pricescale = v.context.symbolInfo?.pricescale ?? 100;
  ctx.fillStyle = t.scaleBackground;
  ctx.fillRect(v.plotL + v.plotW, 0, v.priceAxisW, v.cssHeight);
  ctx.fillStyle = t.scaleText;
  ctx.font = `11px ${v.fontFamily}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const rightEdge = v.plotL + v.plotW + v.priceAxisW - 7;
  for (const p of ticks) {
    const y = yForPrice(v, p);
    if (y < v.plotT + 6 || y > v.plotT + v.plotH - 2) continue;
    ctx.fillText(formatAxisPrice(v, p, pricescale), rightEdge, y);
  }
}
function drawTimeAxis(ctx, v, ticks) {
  const t = v.context.theme;
  const top = timeAxisTopOf(v);
  ctx.fillStyle = t.scaleBackground;
  ctx.fillRect(0, top, v.cssWidth, TIME_AXIS_H);
  ctx.fillStyle = t.scaleText;
  ctx.font = `11px ${v.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const y = top + TIME_AXIS_H / 2;
  const kind = parseResolution(v.context.resolution).kind;
  for (const tk of ticks) {
    const x = xForIndex(v, tk.index);
    if (x < v.plotL + 18 || x > v.plotL + v.plotW - 18) continue;
    ctx.fillText(formatAxisTime(tk.time, kind), x, y);
  }
}

// src/engine/paint/candles.ts
function drawCandles(ctx, v, bars) {
  if (!bars.length) return;
  const t = v.context.theme;
  const spacing = barSpacing(v);
  const bodyW = Math.max(1, Math.min(CANDLE_MAX_WIDTH, spacing * 0.74));
  const half = bodyW / 2;
  const thinBars = spacing < 4;
  const { from, to } = v.visibleRange;
  const start = Math.max(0, Math.floor(from) - 1);
  const end = Math.min(bars.length - 1, Math.ceil(to) + 1);
  for (let i = start; i <= end; i++) {
    const b = bars[i];
    if (!b) continue;
    const up = b.close >= b.open;
    const x = xForIndex(v, i);
    const yO = yForPrice(v, b.open);
    const yC = yForPrice(v, b.close);
    const yH = yForPrice(v, b.high);
    const yL = yForPrice(v, b.low > 0 ? b.low : Math.min(b.open, b.close));
    const body = up ? t.candleUp : t.candleDown;
    const wick = up ? t.wickUp : t.wickDown;
    const border = up ? t.borderUp : t.borderDown;
    ctx.strokeStyle = wick;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const cx = Math.round(x) + 0.5;
    ctx.moveTo(cx, yH);
    ctx.lineTo(cx, yL);
    ctx.stroke();
    if (thinBars) {
      ctx.strokeStyle = body;
      ctx.beginPath();
      ctx.moveTo(cx, yO);
      ctx.lineTo(cx, yC);
      ctx.stroke();
      continue;
    }
    const top = Math.min(yO, yC);
    const h = Math.max(1, Math.abs(yC - yO));
    ctx.fillStyle = body;
    ctx.fillRect(Math.round(x - half), Math.round(top), Math.round(bodyW), Math.round(h));
    if (bodyW >= 3) {
      ctx.strokeStyle = border;
      ctx.strokeRect(Math.round(x - half) + 0.5, Math.round(top) + 0.5, Math.round(bodyW) - 1, Math.max(1, Math.round(h) - 1));
    }
  }
}

// src/engine/paint/volume.ts
function drawVolume(ctx, v) {
  const bars = v.context.bars;
  if (!bars.length) return;
  const t = v.context.theme;
  const { from, to } = v.visibleRange;
  const start = Math.max(0, Math.floor(from) - 1);
  const end = Math.min(bars.length - 1, Math.ceil(to) + 1);
  let maxVol = 0;
  for (let i = start; i <= end; i++) {
    const vol = bars[i]?.volume ?? 0;
    if (vol > maxVol) maxVol = vol;
  }
  if (maxVol <= 0) return;
  const volH = v.plotH * VOLUME_FRACTION;
  const baseY = v.plotT + v.plotH;
  const spacing = barSpacing(v);
  const w = Math.max(1, Math.min(CANDLE_MAX_WIDTH, spacing * 0.74));
  for (let i = start; i <= end; i++) {
    const b = bars[i];
    if (!b || !b.volume) continue;
    const up = b.close >= b.open;
    const h = b.volume / maxVol * volH;
    const x = xForIndex(v, i);
    ctx.fillStyle = up ? t.volUp : t.volDown;
    ctx.fillRect(Math.round(x - w / 2), Math.round(baseY - h), Math.round(w), Math.round(h));
  }
}

// src/engine/paint/lineArea.ts
function drawLineArea(ctx, v, fill) {
  const bars = v.seriesBars;
  if (!bars.length) return;
  const t = v.context.theme;
  const { from, to } = v.visibleRange;
  const start = Math.max(0, Math.floor(from) - 1);
  const end = Math.min(bars.length - 1, Math.ceil(to) + 1);
  const color = t.lineColor ?? t.candleUp;
  ctx.save();
  ctx.beginPath();
  ctx.rect(v.plotL, v.plotT, v.plotW, v.plotH);
  ctx.clip();
  ctx.beginPath();
  let started = false;
  let firstX = 0;
  let lastX = 0;
  for (let i = start; i <= end; i++) {
    const b = bars[i];
    if (!b || !(b.close > 0)) {
      started = false;
      continue;
    }
    const x = xForIndex(v, i);
    const y = yForPrice(v, b.close);
    if (!started) {
      ctx.moveTo(x, y);
      firstX = x;
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
    lastX = x;
  }
  if (fill && started) {
    ctx.lineTo(lastX, v.plotT + v.plotH);
    ctx.lineTo(firstX, v.plotT + v.plotH);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    started = false;
    for (let i = start; i <= end; i++) {
      const b = bars[i];
      if (!b || !(b.close > 0)) {
        started = false;
        continue;
      }
      const x = xForIndex(v, i);
      const y = yForPrice(v, b.close);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

// src/engine/paint/grid.ts
function drawGrid(ctx, v, priceTicks, timeTicks) {
  const t = v.context.theme;
  ctx.lineWidth = 1;
  ctx.strokeStyle = t.horzGrid;
  ctx.beginPath();
  for (const p of priceTicks) {
    const y = Math.round(yForPrice(v, p)) + 0.5;
    if (y < v.plotT || y > v.plotT + v.plotH) continue;
    ctx.moveTo(v.plotL, y);
    ctx.lineTo(v.plotL + v.plotW, y);
  }
  ctx.stroke();
  ctx.strokeStyle = t.vertGrid;
  ctx.beginPath();
  for (const tk of timeTicks) {
    const x = Math.round(xForIndex(v, tk.index)) + 0.5;
    if (x < v.plotL || x > v.plotL + v.plotW) continue;
    ctx.moveTo(x, v.plotT);
    ctx.lineTo(x, v.plotT + v.plotH);
  }
  ctx.stroke();
}
function drawSeparators(ctx, v) {
  const t = v.context.theme;
  const last = v.subPanes[v.subPanes.length - 1];
  const axisTop = last ? last.top + last.h : v.plotT + v.plotH;
  ctx.strokeStyle = t.scaleLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(v.plotL + v.plotW + 0.5, 0);
  ctx.lineTo(v.plotL + v.plotW + 0.5, axisTop);
  ctx.moveTo(0, v.plotT + v.plotH + 0.5);
  ctx.lineTo(v.cssWidth, v.plotT + v.plotH + 0.5);
  for (const p of v.subPanes) {
    ctx.moveTo(0, p.top + p.h + 0.5);
    ctx.lineTo(v.cssWidth, p.top + p.h + 0.5);
  }
  ctx.stroke();
}

// src/engine/paint/studies.ts
function strokeStudyLine(ctx, v, values, color, yFor, clipTop, clipBot) {
  const bars = v.context.bars;
  if (!bars.length || values.length === 0) return;
  const { from, to } = v.visibleRange;
  const start = Math.max(0, Math.floor(from) - 1);
  const end = Math.min(bars.length - 1, Math.ceil(to) + 1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(v.plotL, clipTop, v.plotW, Math.max(1, clipBot - clipTop));
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.lineJoin = "round";
  ctx.beginPath();
  let drawing = false;
  for (let i = start; i <= end; i++) {
    const val = values[i];
    if (val == null || !Number.isFinite(val)) {
      drawing = false;
      continue;
    }
    const x = xForIndex(v, i);
    const y = yFor(val);
    if (!drawing) {
      ctx.moveTo(x, y);
      drawing = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.restore();
}
function drawOverlayStudies(ctx, v) {
  for (const s of v.studies.list()) {
    if (s.def.pane !== "overlay") continue;
    strokeStudyLine(ctx, v, s.values, s.color, (val) => yForPrice(v, val), v.plotT, v.plotT + v.plotH);
  }
}
function subPaneRange(v, def) {
  if (def.range) return def.range;
  const { from, to } = v.visibleRange;
  const start = Math.max(0, Math.floor(from) - 1);
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of v.studies.paneStudies(def)) {
    const end = Math.min(s.values.length - 1, Math.ceil(to) + 1);
    for (let i = start; i <= end; i++) {
      const val = s.values[i];
      if (val == null || !Number.isFinite(val)) continue;
      if (val < lo) lo = val;
      if (val > hi) hi = val;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1 };
  if (lo === hi) return { min: lo - 1, max: hi + 1 };
  const pad = (hi - lo) * 0.1;
  return { min: lo - pad, max: hi + pad };
}
function drawSubPanes(ctx, v, timeTicks) {
  const t = v.context.theme;
  for (const pane of v.subPanes) {
    const { def } = pane;
    const range = subPaneRange(v, def);
    pane.min = range.min;
    pane.max = range.max;
    const span = Math.max(1e-12, range.max - range.min);
    const yFor = (val) => {
      const clamped = Math.max(range.min, Math.min(range.max, val));
      return pane.top + (range.max - clamped) / span * pane.h;
    };
    ctx.fillStyle = t.paneBackground;
    ctx.fillRect(v.plotL, pane.top, v.plotW, pane.h);
    const levels = def.levels ?? [];
    ctx.strokeStyle = t.horzGrid;
    ctx.lineWidth = 1;
    for (const level of levels) {
      const y = Math.round(yFor(level.value)) + 0.5;
      ctx.beginPath();
      ctx.setLineDash(level.dashed ? [3, 3] : []);
      ctx.moveTo(v.plotL, y);
      ctx.lineTo(v.plotL + v.plotW, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = t.vertGrid;
    ctx.beginPath();
    for (const tk of timeTicks) {
      const x = Math.round(xForIndex(v, tk.index)) + 0.5;
      if (x < v.plotL || x > v.plotL + v.plotW) continue;
      ctx.moveTo(x, pane.top);
      ctx.lineTo(x, pane.top + pane.h);
    }
    ctx.stroke();
    for (const s of v.studies.paneStudies(def)) {
      strokeStudyLine(ctx, v, s.values, s.color, yFor, pane.top, pane.top + pane.h);
    }
    ctx.fillStyle = t.scaleText;
    ctx.font = `10px ${v.fontFamily}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const level of levels) {
      if (!level.axisLabel) continue;
      ctx.fillText(String(level.value), v.plotL + v.plotW + 6, yFor(level.value));
    }
    ctx.textBaseline = "top";
    ctx.fillText(def.label ?? def.name, v.plotL + 6, pane.top + 4);
  }
}

// src/data/TimeIndex.ts
var TimeIndex = class {
  constructor(points, expectedStepMs = 0) {
    this.points = points;
    this.expectedStepMs = Number.isFinite(expectedStepMs) && expectedStepMs > 0 ? expectedStepMs : 0;
  }
  get length() {
    return this.points.length;
  }
  /**
   * Return the fractional logical index for `timeMs`.
   *
   * Exact bar timestamps always return their exact array index. Timestamps in
   * session gaps interpolate only between the two adjacent bars, rather than
   * manufacturing logical bars for every missing wall-clock interval.
   */
  indexAt(timeMs) {
    if (!Number.isFinite(timeMs) || this.points.length === 0) return null;
    const n = this.points.length;
    const firstTime = this.points[0].time;
    if (n === 1) {
      return (timeMs - firstTime) / this.edgeStep("right");
    }
    if (timeMs < firstTime) {
      return (timeMs - firstTime) / this.edgeStep("left");
    }
    const lastIndex = n - 1;
    const lastTime = this.points[lastIndex].time;
    if (timeMs > lastTime) {
      return lastIndex + (timeMs - lastTime) / this.edgeStep("right");
    }
    const right = this.lowerBound(timeMs);
    if (right < n && this.points[right].time === timeMs) return right;
    if (right <= 0) return 0;
    if (right >= n) return lastIndex;
    const left = right - 1;
    const leftTime = this.points[left].time;
    const rightTime = this.points[right].time;
    const duration = rightTime - leftTime;
    if (!(duration > 0)) return left;
    return left + (timeMs - leftTime) / duration;
  }
  /**
   * Return the timestamp in milliseconds at a fractional logical index.
   * This is the inverse of `indexAt` for the chart's continuous time axis.
   */
  timeAt(index) {
    if (!Number.isFinite(index) || this.points.length === 0) return null;
    const n = this.points.length;
    const firstTime = this.points[0].time;
    if (n === 1) return firstTime + index * this.edgeStep("right");
    if (index < 0) return firstTime + index * this.edgeStep("left");
    const lastIndex = n - 1;
    const lastTime = this.points[lastIndex].time;
    if (index > lastIndex) {
      return lastTime + (index - lastIndex) * this.edgeStep("right");
    }
    const left = Math.floor(index);
    if (left >= lastIndex || index === left) return this.points[left].time;
    const fraction = index - left;
    const leftTime = this.points[left].time;
    const rightTime = this.points[left + 1].time;
    return leftTime + (rightTime - leftTime) * fraction;
  }
  /** Return the closest real bar index, clamped to the available series. */
  nearestIndex(timeMs) {
    const logical = this.indexAt(timeMs);
    if (logical === null) return null;
    return Math.max(0, Math.min(this.points.length - 1, Math.round(logical)));
  }
  lowerBound(timeMs) {
    let low = 0;
    let high = this.points.length;
    while (low < high) {
      const mid = low + (high - low >> 1);
      if (this.points[mid].time < timeMs) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  edgeStep(side) {
    if (this.expectedStepMs > 0) return this.expectedStepMs;
    const n = this.points.length;
    if (n >= 2) {
      if (side === "left") {
        for (let i = 1; i < n; i++) {
          const step = this.points[i].time - this.points[i - 1].time;
          if (step > 0) return step;
        }
      } else {
        for (let i = n - 1; i > 0; i--) {
          const step = this.points[i].time - this.points[i - 1].time;
          if (step > 0) return step;
        }
      }
    }
    return 1;
  }
};

// src/engine/paint/shapes.ts
function pointXY(v, p, timeIndex = new TimeIndex(v.context.bars, resolutionToMs(v.context.resolution))) {
  if (typeof p.price !== "number" || !Number.isFinite(p.price)) return null;
  const idx = timeIndex.indexAt(p.time * 1e3);
  if (idx === null) return null;
  return { x: xForIndex(v, idx), y: yForPrice(v, p.price) };
}
function drawHandle(ctx, x, y, color) {
  ctx.fillStyle = "#181615";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.rect(x - 3.5, y - 3.5, 7, 7);
  ctx.fill();
  ctx.stroke();
}
function drawComplexShape(ctx, v, s) {
  const o = s.overrides;
  const color = o.linecolor ?? o.color ?? "#2962ff";
  const width = o.linewidth ?? 1;
  const selected = v.selectedShapeId === s.id;
  const timeIndex = new TimeIndex(v.context.bars, resolutionToMs(v.context.resolution));
  const pts = s.points.map((p) => pointXY(v, p, timeIndex)).filter(Boolean);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = selected ? width + 0.75 : width;
  if (s.shape === "trend_line" && pts.length >= 2) {
    const a = pts[0];
    const b = pts[1];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    drawHandle(ctx, a.x, a.y, color);
    drawHandle(ctx, b.x, b.y, color);
    v.shapeScreen.push({ shape: s, y: (a.y + b.y) / 2, hit: "body" });
  } else if (s.shape === "rectangle" && pts.length >= 2) {
    const a = pts[0];
    const b = pts[1];
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    ctx.globalAlpha = 0.12;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    drawHandle(ctx, a.x, a.y, color);
    drawHandle(ctx, b.x, b.y, color);
    v.shapeScreen.push({ shape: s, y: y + h / 2, hit: "body" });
  } else if (s.shape === "fib_retracement" && pts.length >= 2) {
    const a = pts[0];
    const b = pts[1];
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const top = Math.min(a.y, b.y);
    const bot = Math.max(a.y, b.y);
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, v.plotL + v.plotW - 4);
    const pricescale = v.context.symbolInfo?.pricescale ?? 100;
    ctx.font = `10px ${v.fontFamily}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    for (const lv of levels) {
      const y = a.y + (b.y - a.y) * lv;
      const yy = Math.round(y) + 0.5;
      ctx.globalAlpha = lv === 0 || lv === 1 ? 0.9 : 0.55;
      ctx.setLineDash(lv === 0.5 ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(left, yy);
      ctx.lineTo(right, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.85;
      ctx.fillText(`${(lv * 100).toFixed(1)}%  ${formatAxisPrice(v, priceForY(v, y), pricescale)}`, left + 4, yy - 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(Math.round(a.x) + 0.5, top);
    ctx.lineTo(Math.round(a.x) + 0.5, bot);
    ctx.stroke();
    ctx.globalAlpha = 1;
    drawHandle(ctx, a.x, a.y, color);
    drawHandle(ctx, b.x, b.y, color);
    v.shapeScreen.push({ shape: s, y: (a.y + b.y) / 2, hit: "body" });
  } else if (s.shape === "text" && pts.length >= 1) {
    const a = pts[0];
    const label = s.text || "Text";
    ctx.font = `12px ${v.fontFamily}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(24,22,21,0.75)";
    ctx.fillRect(a.x - 2, a.y - 14, tw + 6, 16);
    ctx.fillStyle = color;
    ctx.fillText(label, a.x, a.y);
    drawHandle(ctx, a.x, a.y, color);
    v.shapeScreen.push({ shape: s, y: a.y, hit: "body" });
  }
  ctx.restore();
}
function drawShapes(ctx, v) {
  v.shapeScreen.length = 0;
  const pricescale = v.context.symbolInfo?.pricescale ?? 100;
  const hLines = [];
  for (const s of v.shapes.list()) {
    if (s.shape === "horizontal_line") {
      const price = s.points[0]?.price;
      if (typeof price !== "number" || !Number.isFinite(price)) continue;
      const y = yForPrice(v, price);
      hLines.push({ shape: s, price, y, labelY: y });
      continue;
    }
    drawComplexShape(ctx, v, s);
  }
  hLines.sort((a, b) => a.y - b.y);
  const minGap = 14;
  for (let i = 1; i < hLines.length; i++) {
    const prev = hLines[i - 1];
    const cur = hLines[i];
    if (cur.labelY - prev.labelY < minGap) {
      cur.labelY = prev.labelY + minGap;
    }
  }
  for (const h of hLines) {
    const s = h.shape;
    const y = h.y;
    if (y < v.plotT - 40 || y > v.plotT + v.plotH + 40) {
      v.shapeScreen.push({ shape: s, y, hit: "body" });
      continue;
    }
    const o = s.overrides;
    const color = o.linecolor ?? "#2962ff";
    const width = o.linewidth ?? 1;
    const style = o.linestyle ?? 0;
    const textColor = o.textcolor ?? color;
    const fontsize = o.fontsize ?? 11;
    const showPrice = o.showPrice !== false;
    const bold = o.bold === true;
    const italic = o.italic === true;
    const selected = v.selectedShapeId === s.id;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = selected ? width + 0.5 : width;
    ctx.setLineDash(style === 2 ? [5, 4] : style === 1 ? [2, 3] : []);
    const yy = Math.round(y) + 0.5;
    ctx.beginPath();
    ctx.moveTo(v.plotL, yy);
    ctx.lineTo(v.plotL + v.plotW, yy);
    ctx.stroke();
    ctx.setLineDash([]);
    if (s.text) {
      ctx.font = `${italic ? "italic " : ""}${bold ? "bold " : ""}${fontsize}px ${v.fontFamily}`;
      ctx.fillStyle = textColor;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      const ly = Math.round(h.labelY) - 3;
      if (Math.abs(h.labelY - y) > 2) {
        const tw = ctx.measureText(s.text).width;
        ctx.fillStyle = "rgba(24,22,21,0.72)";
        ctx.fillRect(v.plotL + v.plotW - 8 - tw, ly - fontsize, tw + 4, fontsize + 4);
        ctx.fillStyle = textColor;
      }
      ctx.fillText(s.text, v.plotL + v.plotW - 6, ly);
    }
    if (showPrice) {
      drawAxisTag(ctx, v, yy - 0.5, formatAxisPrice(v, h.price, pricescale), color, "#ffffff");
    }
    ctx.restore();
    v.shapeScreen.push({ shape: s, y, hit: "body" });
  }
}
function drawDraft(ctx, v) {
  if (!v.draft || v.draft.points.length === 0) return;
  const tool = v.draft.tool;
  const ghost = {
    id: "draft",
    shape: tool === "cursor" ? "trend_line" : tool,
    points: v.draft.points,
    text: tool === "text" ? "\u2026" : "",
    lock: true,
    disableSelection: true,
    zOrder: "top",
    overrides: { linecolor: "#66d89e", linewidth: 1, linestyle: 2 }
  };
  if (v.draft.points.length === 1 && v.crosshair.active && tool !== "horizontal_line" && tool !== "text") {
    const bars = v.context.bars;
    let unixTime = 0;
    if (bars.length) {
      const timeIndex = new TimeIndex(bars, resolutionToMs(v.context.resolution));
      const idx = indexForX(v, v.crosshair.x);
      unixTime = (timeIndex.timeAt(idx) ?? 0) / 1e3;
    }
    const price = priceForY(v, v.crosshair.y);
    ghost.points = [...v.draft.points, { time: unixTime, price }];
  }
  if (ghost.shape === "horizontal_line" && ghost.points[0]) {
    const y = yForPrice(v, ghost.points[0].price);
    ctx.save();
    ctx.strokeStyle = "#66d89e";
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(v.plotL, Math.round(y) + 0.5);
    ctx.lineTo(v.plotL + v.plotW, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.restore();
    return;
  }
  drawComplexShape(ctx, v, ghost);
}
function distToSegment(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = a.x + t * dx;
  const qy = a.y + t * dy;
  return Math.hypot(px - qx, py - qy);
}
function hitComplexShape(v, shape, x, y, tolMul = 1) {
  const timeIndex = new TimeIndex(v.context.bars, resolutionToMs(v.context.resolution));
  const pts = shape.points.map((p) => pointXY(v, p, timeIndex)).filter(Boolean);
  if (pts.length === 0) return false;
  for (const p of pts) {
    if (Math.abs(p.x - x) <= 6 * tolMul && Math.abs(p.y - y) <= 6 * tolMul) return true;
  }
  if (shape.shape === "trend_line" && pts.length >= 2) {
    return distToSegment(x, y, pts[0], pts[1]) <= 5 * tolMul;
  }
  if (shape.shape === "rectangle" && pts.length >= 2) {
    const a = pts[0];
    const b = pts[1];
    const l = Math.min(a.x, b.x);
    const r = Math.max(a.x, b.x);
    const t = Math.min(a.y, b.y);
    const bot = Math.max(a.y, b.y);
    const tol = 4 * tolMul;
    const nearEdge = (Math.abs(x - l) <= tol || Math.abs(x - r) <= tol) && y >= t - tol && y <= bot + tol || (Math.abs(y - t) <= tol || Math.abs(y - bot) <= tol) && x >= l - tol && x <= r + tol;
    return nearEdge;
  }
  if (shape.shape === "fib_retracement" && pts.length >= 2) {
    return distToSegment(x, y, pts[0], pts[1]) <= 6 * tolMul;
  }
  if (shape.shape === "text" && pts[0]) {
    return Math.abs(pts[0].x - x) <= 20 * tolMul && Math.abs(pts[0].y - y) <= 12 * tolMul;
  }
  return false;
}
function neededPoints(tool) {
  if (tool === "horizontal_line" || tool === "text") return 1;
  if (tool === "trend_line" || tool === "rectangle" || tool === "fib_retracement") return 2;
  return 0;
}

// src/engine/paint/marks.ts
function drawMarks(ctx, v) {
  v.markScreen.length = 0;
  if (!v.context.features.has("mark_on_bars")) return;
  const marks = v.context.marks;
  const bars = v.context.bars;
  if (!marks.length || !bars.length) return;
  const timeIndex = new TimeIndex(bars, resolutionToMs(v.context.resolution));
  const r = 7;
  const gap = 3;
  const maxStack = 4;
  const bottomLimit = v.plotT + v.plotH - 4;
  const topLimit = v.plotT + 4;
  const byBar = /* @__PURE__ */ new Map();
  for (const m of marks) {
    const timeMs = m.time * 1e3;
    const logical = timeIndex.indexAt(timeMs);
    if (logical === null) continue;
    const idx = Math.round(logical);
    if (idx < 0 || idx >= bars.length) continue;
    const list = byBar.get(idx);
    if (list) list.push(m);
    else byBar.set(idx, [m]);
  }
  const indices = Array.from(byBar.keys()).sort((a, b) => a - b);
  let lastDrawnX = -Infinity;
  for (const idx of indices) {
    const x = xForIndex(v, idx);
    if (x < v.plotL - r || x > v.plotL + v.plotW + r) continue;
    if (x - lastDrawnX < 2 * r + 1) continue;
    lastDrawnX = x;
    const group = byBar.get(idx);
    const bar = bars[idx];
    const highY = yForPrice(v, bar.high);
    const stepY = 2 * r + gap;
    const shown = Math.min(group.length, maxStack);
    const minStart = topLimit + r + (shown - 1) * stepY;
    let y = Math.max(minStart, Math.min(bottomLimit - r, highY - r - 6));
    for (let k = 0; k < shown; k++) {
      const m = group[k];
      const isLast = k === shown - 1 && group.length > maxStack;
      const col = m.color;
      const border = typeof col === "object" ? col.border : "#2962ff";
      const bg = typeof col === "object" ? col.background : "#2962ff";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = border;
      ctx.stroke();
      const label = isLast ? `+${group.length - maxStack + 1}` : m.label ? m.label.slice(0, 2) : "";
      if (label) {
        ctx.fillStyle = m.labelFontColor || "#fff";
        ctx.font = `bold ${isLast ? 8 : 9}px ${v.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x, y + 0.5);
      }
      v.markScreen.push({ mark: m, x, y, r });
      y -= stepY;
    }
  }
}
function drawMarkTooltip(ctx, v) {
  if (!v.hoverMark) return;
  const hit = v.markScreen.find((m) => m.mark === v.hoverMark);
  if (!hit) return;
  const text = v.hoverMark.text || v.hoverMark.label || "";
  if (!text) return;
  ctx.font = `11px ${v.fontFamily}`;
  const pad = 6;
  const lines = text.split("\n").slice(0, 4);
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width), 40);
  const th = lines.length * 14 + pad * 2;
  let x = hit.x + hit.r + 8;
  let y = hit.y - th / 2;
  if (x + tw + pad * 2 > v.plotL + v.plotW) x = hit.x - hit.r - 8 - tw - pad * 2;
  if (y < v.plotT) y = v.plotT + 4;
  ctx.fillStyle = "rgba(24,22,21,0.92)";
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  roundRect(ctx, x, y, tw + pad * 2, th, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f4eee1";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + i * 14));
}

// src/engine/paint/lastPrice.ts
function drawLastPrice(ctx, v) {
  const bars = v.context.bars;
  const last = bars[bars.length - 1];
  if (!last || !(last.close > 0)) return;
  const t = v.context.theme;
  const price = last.close;
  const up = last.close >= last.open;
  const color = up ? t.candleUp : t.candleDown;
  const pricescale = v.context.symbolInfo?.pricescale ?? 100;
  const y = yForPrice(v, price);
  if (y >= v.plotT && y <= v.plotT + v.plotH) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    const yy = Math.round(y) + 0.5;
    ctx.beginPath();
    ctx.moveTo(v.plotL, yy);
    ctx.lineTo(v.plotL + v.plotW, yy);
    ctx.stroke();
    ctx.restore();
  }
  const cy = Math.max(v.plotT + 8, Math.min(v.plotT + v.plotH - 8, y));
  drawAxisTag(ctx, v, cy, formatAxisPrice(v, price, pricescale), color, "#10100e", true);
}

// src/engine/paint/crosshair.ts
function drawCrosshair(ctx, v) {
  if (!v.crosshair.active) return;
  const t = v.context.theme;
  const { x, y } = v.crosshair;
  const contentBottom = timeAxisTopOf(v);
  if (x < v.plotL || x > v.plotL + v.plotW || y < v.plotT || y > contentBottom) return;
  const bars = v.context.bars;
  const idx = Math.round(indexForX(v, x));
  const snapBar = bars[Math.max(0, Math.min(bars.length - 1, idx))];
  const inMainPane = y <= v.plotT + v.plotH;
  ctx.save();
  ctx.strokeStyle = t.crosshair;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, v.plotT);
  ctx.lineTo(Math.round(x) + 0.5, contentBottom);
  if (inMainPane || v.subPanes.some((p) => y >= p.top && y <= p.top + p.h)) {
    ctx.moveTo(v.plotL, Math.round(y) + 0.5);
    ctx.lineTo(v.plotL + v.plotW, Math.round(y) + 0.5);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  const pill = neutralPill(v);
  const pricescale = v.context.symbolInfo?.pricescale ?? 100;
  if (t.showPriceScaleCrosshairLabel && inMainPane) {
    drawAxisTag(ctx, v, y, formatAxisPrice(v, priceForY(v, y), pricescale), pill.bg, pill.fg);
  } else if (t.showPriceScaleCrosshairLabel && !inMainPane) {
    const pane = v.subPanes.find((p) => y >= p.top && y <= p.top + p.h);
    if (pane) {
      const val = pane.max - (y - pane.top) / Math.max(1, pane.h) * (pane.max - pane.min);
      const label = pane.def.formatValue ? pane.def.formatValue(val) : Math.abs(val) >= 1e3 ? formatCompact(val) : val.toFixed(1);
      drawAxisTag(ctx, v, y, label, pill.bg, pill.fg, false, pane.top, pane.top + pane.h);
    }
  }
  if (t.showTimeScaleCrosshairLabel && snapBar && idx >= 0 && idx < bars.length) {
    const label = formatCrosshairTime(snapBar.time, parseResolution(v.context.resolution).kind);
    ctx.font = `11px ${v.fontFamily}`;
    const w = ctx.measureText(label).width + 14;
    const tx = Math.max(v.plotL, Math.min(v.plotL + v.plotW - w, x - w / 2));
    const axisTop = timeAxisTopOf(v);
    ctx.fillStyle = pill.bg;
    roundRect(ctx, tx, axisTop + 2, w, TIME_AXIS_H - 4, 3);
    ctx.fill();
    ctx.fillStyle = pill.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, tx + w / 2, axisTop + TIME_AXIS_H / 2 + 0.5);
  }
}

// src/engine/paint/legend.ts
function drawLegend(ctx, v) {
  if (!v.context.features.has("legend_widget")) return;
  const bars = v.context.bars;
  if (!bars.length) return;
  const idx = v.crosshair.active ? Math.max(0, Math.min(bars.length - 1, Math.round(indexForX(v, v.crosshair.x)))) : bars.length - 1;
  const bar = bars[idx];
  if (!bar) return;
  const pricescale = v.context.symbolInfo?.pricescale ?? 100;
  const t = v.context.theme;
  const up = bar.close >= bar.open;
  const col = up ? t.candleUp : t.candleDown;
  const dim = t.scaleText;
  const f = (val) => v.context.formatPrice(val, pricescale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let x = 10;
  const y = 19;
  ctx.font = `12px ${v.fontFamily}`;
  const seg = (label, value) => {
    ctx.fillStyle = dim;
    ctx.fillText(label, x, y);
    x += ctx.measureText(label).width + 3;
    ctx.fillStyle = col;
    ctx.fillText(value, x, y);
    x += ctx.measureText(value).width + 9;
  };
  const compactLegend = v.plotW < 420;
  if (!compactLegend) {
    seg("O", f(bar.open));
    seg("H", f(bar.high));
    seg("L", f(bar.low));
  }
  seg("C", f(bar.close));
  if (bar.open > 0) {
    const abs = bar.close - bar.open;
    const pct = abs / bar.open * 100;
    const sign = abs >= 0 ? "+" : "-";
    const chgStr = `${sign}${f(Math.abs(abs))} (${sign}${Math.abs(pct).toFixed(2)}%)`;
    ctx.fillStyle = col;
    ctx.fillText(chgStr, x, y);
    x += ctx.measureText(chgStr).width + 12;
  }
  for (const s of v.studies.list()) {
    const val = s.values[idx];
    if (val == null || !Number.isFinite(val)) continue;
    const label = `${s.name}${s.length}`;
    const value = s.def.formatValue ? s.def.formatValue(val) : s.def.pane === "pane" ? val.toFixed(1) : f(val);
    ctx.fillStyle = dim;
    ctx.fillText(label, x, y);
    x += ctx.measureText(label).width + 3;
    ctx.fillStyle = s.color;
    ctx.fillText(value, x, y);
    x += ctx.measureText(value).width + 9;
  }
  if (bar.volume) {
    ctx.fillStyle = dim;
    ctx.font = `11px ${v.fontFamily}`;
    ctx.fillText(`Vol ${formatVolume(bar.volume)}`, 10, 35);
  }
}

// src/engine/scene.ts
var FINANCE_PAINT_ORDER = [
  "grid",
  "volume",
  "series",
  "overlayStudies",
  "shapes",
  "draft",
  "barMarks",
  "priceAxis",
  "subPanes",
  "timeAxis",
  "lastPrice",
  "crosshair",
  "legend",
  "markTooltip",
  "separators"
];
function paintFinanceMark(kind, ctx, v, priceTicks, timeTicks) {
  switch (kind) {
    case "grid":
      drawGrid(ctx, v, priceTicks, timeTicks);
      break;
    case "volume":
      drawVolume(ctx, v);
      break;
    case "series": {
      const style = v.context.chartStyle;
      if (style === "line" || style === "area") drawLineArea(ctx, v, style === "area");
      else drawCandles(ctx, v, v.seriesBars);
      break;
    }
    case "overlayStudies":
      drawOverlayStudies(ctx, v);
      break;
    case "shapes":
      drawShapes(ctx, v);
      break;
    case "draft":
      drawDraft(ctx, v);
      break;
    case "barMarks":
      drawMarks(ctx, v);
      break;
    case "priceAxis":
      drawPriceAxis(ctx, v, priceTicks);
      break;
    case "subPanes":
      drawSubPanes(ctx, v, timeTicks);
      break;
    case "timeAxis":
      drawTimeAxis(ctx, v, timeTicks);
      break;
    case "lastPrice":
      drawLastPrice(ctx, v);
      break;
    case "crosshair":
      drawCrosshair(ctx, v);
      break;
    case "legend":
      drawLegend(ctx, v);
      break;
    case "markTooltip":
      drawMarkTooltip(ctx, v);
      break;
    case "separators":
      drawSeparators(ctx, v);
      break;
  }
}
function paintFinanceScene(ctx, v, priceTicks, timeTicks) {
  for (const kind of FINANCE_PAINT_ORDER) {
    paintFinanceMark(kind, ctx, v, priceTicks, timeTicks);
  }
}

// src/engine/gestures.ts
var GestureController = class {
  constructor(host) {
    this.host = host;
    this.dragging = null;
    this.activePointers = /* @__PURE__ */ new Map();
    this.pinch = null;
    this.longPressTimer = null;
    this.longPressStart = { x: 0, y: 0 };
    this.touchCrosshair = false;
    this.boundMove = (e) => this.onPointerMove(e);
    this.boundDown = (e) => this.onPointerDown(e);
    this.boundUp = (e) => this.onPointerUp(e);
    this.boundCancel = (e) => this.onPointerCancel(e);
    this.boundLeave = (e) => this.onPointerLeave(e);
    this.boundWheel = (e) => this.onWheel(e);
    this.boundDbl = (e) => this.onDblClick(e);
    this.boundKey = (e) => this.onKeyDown(e);
    this.boundFocus = () => this.onFocus();
    this.boundBlur = () => this.onBlur();
  }
  attach() {
    const canvas = this.host.canvas;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointermove", this.boundMove);
    canvas.addEventListener("pointerdown", this.boundDown);
    window.addEventListener("pointerup", this.boundUp);
    canvas.addEventListener("pointercancel", this.boundCancel);
    canvas.addEventListener("pointerleave", this.boundLeave);
    canvas.addEventListener("wheel", this.boundWheel, { passive: false });
    canvas.addEventListener("dblclick", this.boundDbl);
    canvas.addEventListener("keydown", this.boundKey);
    canvas.addEventListener("focus", this.boundFocus);
    canvas.addEventListener("blur", this.boundBlur);
    canvas.tabIndex = 0;
  }
  destroy() {
    this.clearLongPress();
    const canvas = this.host.canvas;
    canvas.removeEventListener("pointermove", this.boundMove);
    canvas.removeEventListener("pointerdown", this.boundDown);
    window.removeEventListener("pointerup", this.boundUp);
    canvas.removeEventListener("pointercancel", this.boundCancel);
    canvas.removeEventListener("pointerleave", this.boundLeave);
    canvas.removeEventListener("wheel", this.boundWheel);
    canvas.removeEventListener("dblclick", this.boundDbl);
    canvas.removeEventListener("keydown", this.boundKey);
    canvas.removeEventListener("focus", this.boundFocus);
    canvas.removeEventListener("blur", this.boundBlur);
    this.onBlur();
  }
  onFocus() {
    const canvas = this.host.canvas;
    let focusVisible = true;
    try {
      focusVisible = canvas.matches(":focus-visible");
    } catch {
    }
    if (!focusVisible) return;
    this.showFocusRing();
  }
  showFocusRing() {
    const canvas = this.host.canvas;
    canvas.style.outline = `2px solid ${this.host.context.theme.scaleText}`;
    canvas.style.outlineOffset = "-2px";
  }
  onBlur() {
    const canvas = this.host.canvas;
    canvas.style.removeProperty("outline");
    canvas.style.removeProperty("outline-offset");
  }
  pointerXY(e) {
    const rect = this.host.canvas.getBoundingClientRect();
    const rw = rect.width || 1;
    const rh = rect.height || 1;
    const cw = this.host.engine.cssWidth || this.host.canvas.clientWidth || 1;
    const ch = this.host.engine.cssHeight || this.host.canvas.clientHeight || 1;
    return {
      x: (e.clientX - rect.left) * (cw / rw),
      y: (e.clientY - rect.top) * (ch / rh)
    };
  }
  timePriceAt(x, y) {
    const s = this.host.plotScale();
    const bars = this.host.context.bars;
    let unixTime = 0;
    if (bars.length) {
      const idx = indexForX(s, x);
      const timeIndex = new TimeIndex(bars, resolutionToMs(this.host.context.resolution));
      unixTime = (timeIndex.timeAt(idx) ?? 0) / 1e3;
    }
    return { unixTime, price: priceForY(s, y) };
  }
  contentBottom() {
    return timeAxisTop(this.host.plotT, this.host.plotH, this.host.subPanes);
  }
  hitTestAt(x, y, tolMul) {
    const h = this.host;
    const contentBottom = this.contentBottom();
    const inPriceAxis = x > h.plotL + h.plotW && y < h.plotT + h.plotH;
    const inTimeAxis = y >= contentBottom && x < h.plotL + h.plotW;
    h.hoverShapeId = null;
    h.hoverMark = null;
    if (inPriceAxis || inTimeAxis || y > h.plotT + h.plotH) return;
    const view = h.financeView();
    for (const m of h.markScreen) {
      const dx = x - m.x;
      const dy = y - m.y;
      const r = m.r + 2 * tolMul;
      if (dx * dx + dy * dy <= r * r) {
        h.hoverMark = m.mark;
        break;
      }
    }
    if (!h.hoverMark) {
      for (const { shape, y: sy } of h.shapeScreen) {
        if (shape.lock || shape.disableSelection) continue;
        if (shape.shape === "horizontal_line" && Math.abs(sy - y) <= 4 * tolMul && x <= h.plotL + h.plotW) {
          h.hoverShapeId = shape.id;
          break;
        }
        if (shape.shape !== "horizontal_line") {
          if (hitComplexShape(view, shape, x, y, tolMul)) {
            h.hoverShapeId = shape.id;
            break;
          }
        }
      }
    }
  }
  onPointerMove(e) {
    const h = this.host;
    const { x, y } = this.pointerXY(e);
    const contentBottom = this.contentBottom();
    const tracked = this.activePointers.get(e.pointerId);
    if (tracked) {
      tracked.x = x;
      tracked.y = y;
    }
    if (this.pinch && this.activePointers.size >= 2) {
      this.updatePinch();
      h.requestPaint();
      return;
    }
    if (this.longPressTimer != null && Math.hypot(x - this.longPressStart.x, y - this.longPressStart.y) > 8) {
      this.clearLongPress();
    }
    if (this.touchCrosshair && tracked) {
      h.crosshair = { x, y, active: true };
      h.requestPaint();
      return;
    }
    if (e.pointerType === "mouse") {
      h.crosshair = {
        x,
        y,
        active: x >= h.plotL && x <= h.plotL + h.plotW && y >= h.plotT && y <= contentBottom
      };
    }
    const s = h.plotScale();
    const spacing = barSpacing(s);
    if (this.dragging?.kind === "pan") {
      const dxBars = (x - this.dragging.startX) / spacing;
      h.context.visibleRange = {
        from: this.dragging.startFrom - dxBars,
        to: this.dragging.startTo - dxBars
      };
      void h.data.maybeLoadMoreHistory();
    } else if (this.dragging?.kind === "priceScale") {
      const dy = y - this.dragging.startY;
      const factor = Math.min(20, Math.max(0.05, 1 + dy / (h.plotH * 0.5)));
      const center = (this.dragging.startMin + this.dragging.startMax) / 2;
      const half = (this.dragging.startMax - this.dragging.startMin) / 2 * factor;
      h.context.autoScalePrice = false;
      h.context.priceRange = {
        min: fromDisplay(s, center - half),
        max: fromDisplay(s, center + half)
      };
    } else if (this.dragging?.kind === "timeScale") {
      const dx = x - this.dragging.startX;
      const span = this.dragging.startTo - this.dragging.startFrom;
      const factor = Math.min(20, Math.max(0.05, 1 - dx / (h.plotW * 0.5)));
      const minSpan = h.plotW / MAX_BAR_SPACING;
      const maxSpan = h.plotW / MIN_BAR_SPACING;
      const newSpan = Math.min(maxSpan, Math.max(minSpan, span * factor));
      h.context.visibleRange = { from: this.dragging.startTo - newSpan, to: this.dragging.startTo };
      void h.data.maybeLoadMoreHistory();
    } else if (this.dragging?.kind === "shape") {
      const sh = h.shapes.get(this.dragging.id);
      if (sh) {
        const pt = sh.points[this.dragging.pointIndex];
        if (pt) {
          const tp = this.timePriceAt(x, y);
          if (sh.shape === "horizontal_line") {
            pt.price = tp.price;
          } else {
            pt.price = tp.price;
            pt.time = tp.unixTime;
          }
        }
      }
    } else if (e.pointerType === "mouse") {
      const inPriceAxis = x > h.plotL + h.plotW && y < h.plotT + h.plotH;
      const inTimeAxis = y >= contentBottom && x < h.plotL + h.plotW;
      this.hitTestAt(x, y, 1);
      const drawing = h.context.drawingTool !== "cursor";
      const hoverShape = h.hoverShapeId ? h.shapes.get(h.hoverShapeId) : void 0;
      const shapeCursor = hoverShape?.shape === "horizontal_line" ? "ns-resize" : "move";
      h.canvas.style.cursor = inPriceAxis ? "ns-resize" : inTimeAxis ? "ew-resize" : h.hoverShapeId ? shapeCursor : drawing ? "crosshair" : h.hoverMark ? "pointer" : "crosshair";
    }
    h.requestPaint();
  }
  onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const h = this.host;
    const { x, y } = this.pointerXY(e);
    h.lastPointerType = e.pointerType || "mouse";
    h.canvas.focus({ preventScroll: true });
    this.onBlur();
    this.activePointers.set(e.pointerId, { x, y, type: e.pointerType });
    try {
      h.canvas.setPointerCapture?.(e.pointerId);
    } catch {
    }
    if (this.activePointers.size === 2) {
      this.clearLongPress();
      this.touchCrosshair = false;
      this.dragging = null;
      this.startPinch();
      return;
    }
    if (e.pointerType !== "mouse") {
      this.hitTestAt(x, y, 2);
      if (h.crosshair.active && !this.touchCrosshair) {
        h.crosshair.active = false;
        h.requestPaint();
      }
      if (h.context.drawingTool === "cursor" && !h.hoverShapeId) {
        this.armLongPress(x, y);
      }
    }
    this.beginInteraction(x, y);
  }
  startPinch() {
    const h = this.host;
    const pts = Array.from(this.activePointers.values());
    const a = pts[0];
    const b = pts[1];
    const { from, to } = h.context.visibleRange;
    const span = to - from;
    const midX = (a.x + b.x) / 2;
    const s = h.plotScale();
    const anchorIndex = indexForX(s, midX);
    this.pinch = {
      startSpanPx: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
      startFrom: from,
      startTo: to,
      anchorIndex,
      anchorFrac: span > 0 ? (anchorIndex - from) / span : 0.5
    };
  }
  updatePinch() {
    if (!this.pinch) return;
    const h = this.host;
    const pts = Array.from(this.activePointers.values());
    if (pts.length < 2) return;
    const spanPx = Math.max(10, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
    const scale = this.pinch.startSpanPx / spanPx;
    const startSpan = this.pinch.startTo - this.pinch.startFrom;
    const newSpan = Math.max(
      h.plotW / MAX_BAR_SPACING,
      Math.min(h.plotW / MIN_BAR_SPACING, startSpan * scale)
    );
    const from = this.pinch.anchorIndex - this.pinch.anchorFrac * newSpan;
    h.context.visibleRange = { from, to: from + newSpan };
    void h.data.maybeLoadMoreHistory();
  }
  armLongPress(x, y) {
    this.clearLongPress();
    this.longPressStart = { x, y };
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null;
      this.touchCrosshair = true;
      this.dragging = null;
      this.host.crosshair = { x: this.longPressStart.x, y: this.longPressStart.y, active: true };
      this.host.requestPaint();
    }, 300);
  }
  clearLongPress() {
    if (this.longPressTimer != null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }
  beginInteraction(x, y) {
    const h = this.host;
    const contentBottom = this.contentBottom();
    const inPriceAxis = x > h.plotL + h.plotW && y < h.plotT + h.plotH;
    const inTimeAxis = y >= contentBottom && x < h.plotL + h.plotW;
    const inPlot = x <= h.plotL + h.plotW && y >= h.plotT && y <= h.plotT + h.plotH;
    const tool = h.context.drawingTool;
    if (tool !== "cursor" && inPlot && !inPriceAxis && !inTimeAxis) {
      const tp = this.timePriceAt(x, y);
      const point = { time: tp.unixTime, price: tp.price };
      if (!h.draft || h.draft.tool !== tool) {
        h.draft = { tool, points: [point] };
      } else {
        h.draft.points.push(point);
      }
      const need = neededPoints(tool);
      if (h.draft.points.length >= need) {
        this.finishDraft();
      }
      h.requestPaint();
      return;
    }
    if (h.hoverShapeId) {
      const sh = h.shapes.get(h.hoverShapeId);
      let pointIndex = 0;
      if (sh && sh.shape !== "horizontal_line") {
        const view = h.financeView();
        const pts = sh.points.map((p) => pointXY(view, p));
        let best = Infinity;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          if (!p) continue;
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < best) {
            best = d;
            pointIndex = i;
          }
        }
      }
      h.context.selectedShapeId = h.hoverShapeId;
      this.dragging = { kind: "shape", id: h.hoverShapeId, startY: y, pointIndex };
      return;
    }
    if (inPriceAxis) {
      this.dragging = { kind: "priceScale", startY: y, startMin: h.priceMin, startMax: h.priceMax };
      h.context.autoScalePrice = false;
      const s = h.plotScale();
      h.context.priceRange = {
        min: fromDisplay(s, h.priceMin),
        max: fromDisplay(s, h.priceMax)
      };
      return;
    }
    if (inTimeAxis) {
      this.dragging = {
        kind: "timeScale",
        startX: x,
        startFrom: h.context.visibleRange.from,
        startTo: h.context.visibleRange.to
      };
      return;
    }
    h.context.selectedShapeId = null;
    if (x <= h.plotL + h.plotW && y <= h.plotT + h.plotH) {
      this.dragging = {
        kind: "pan",
        startX: x,
        startFrom: h.context.visibleRange.from,
        startTo: h.context.visibleRange.to
      };
    }
  }
  finishDraft() {
    const h = this.host;
    if (!h.draft) return;
    const { tool, points } = h.draft;
    h.draft = null;
    let text = "";
    if (tool === "text") {
      text = window.prompt("Label text", "Note") ?? "";
      if (!text.trim()) {
        h.onToolDone?.("cursor");
        h.context.drawingTool = "cursor";
        h.requestPaint();
        return;
      }
    }
    const defaults = {
      linecolor: tool === "fib_retracement" ? "#f5a623" : "#66d89e",
      linewidth: 1,
      linestyle: tool === "horizontal_line" ? 2 : 0,
      showPrice: tool === "horizontal_line"
    };
    void h.shapes.createPoints(points, {
      shape: tool,
      text,
      lock: false,
      overrides: defaults
    }).then((id) => {
      h.context.selectedShapeId = id;
    });
    h.context.drawingTool = "cursor";
    h.onToolDone?.("cursor");
    h.requestPaint();
  }
  onPointerUp(e) {
    const h = this.host;
    this.activePointers.delete(e.pointerId);
    this.clearLongPress();
    if (this.pinch && this.activePointers.size < 2) {
      this.pinch = null;
      this.dragging = null;
    }
    if (this.activePointers.size === 0) {
      if (this.dragging?.kind === "shape") {
        h.context.drawingEvent.fire(this.dragging.id, "points_changed");
      }
      this.dragging = null;
      this.touchCrosshair = false;
    }
  }
  onPointerCancel(e) {
    this.activePointers.delete(e.pointerId);
    this.clearLongPress();
    if (this.activePointers.size < 2) this.pinch = null;
    if (this.activePointers.size === 0) {
      this.dragging = null;
      this.touchCrosshair = false;
    }
  }
  onPointerLeave(e) {
    if (e.pointerType !== "mouse") return;
    const h = this.host;
    h.crosshair.active = false;
    h.hoverMark = null;
    if (!this.dragging) h.canvas.style.cursor = "default";
    h.requestPaint();
  }
  onWheel(e) {
    e.preventDefault();
    const h = this.host;
    const { from, to } = h.context.visibleRange;
    const span = to - from;
    const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
    const newSpan = Math.max(h.plotW / MAX_BAR_SPACING, Math.min(h.plotW / MIN_BAR_SPACING, span * factor));
    const { x } = this.pointerXY(e);
    const s = h.plotScale();
    const pivot = indexForX(s, x);
    const leftFrac = (pivot - from) / span;
    h.context.visibleRange = {
      from: pivot - leftFrac * newSpan,
      to: pivot + (1 - leftFrac) * newSpan
    };
    void h.data.maybeLoadMoreHistory();
    h.requestPaint();
  }
  onDblClick(e) {
    const h = this.host;
    const { x, y } = this.pointerXY(e);
    const inPriceAxis = x > h.plotL + h.plotW && y < h.plotT + h.plotH;
    h.context.priceRange = null;
    h.context.autoScalePrice = true;
    if (!inPriceAxis) h.fitContent();
    else h.requestPaint();
  }
  onKeyDown(e) {
    const h = this.host;
    if (e.target !== h.canvas) return;
    this.showFocusRing();
    const { from, to } = h.context.visibleRange;
    const span = to - from;
    if (e.key === "Escape") {
      h.draft = null;
      h.context.drawingTool = "cursor";
      h.context.selectedShapeId = null;
      h.onToolDone?.("cursor");
      h.requestPaint();
      h.engine.announce("Drawing cancelled.");
      e.preventDefault();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (h.context.selectedShapeId) {
        h.shapes.remove(h.context.selectedShapeId);
        h.requestPaint();
        h.engine.announce("Selected drawing removed.");
        e.preventDefault();
      }
      return;
    }
    if (e.key === "f" || e.key === "F") {
      h.fitContent();
      h.engine.announce("Chart fitted to all data.");
      e.preventDefault();
      return;
    }
    if (e.key === "+" || e.key === "=") {
      const newSpan = Math.max(h.plotW / MAX_BAR_SPACING, span / 1.15);
      h.context.visibleRange = { from: to - newSpan, to };
      h.requestPaint();
      h.engine.announce("Zoomed in.");
      e.preventDefault();
      return;
    }
    if (e.key === "-" || e.key === "_") {
      const newSpan = Math.min(h.plotW / MIN_BAR_SPACING, span * 1.15);
      h.context.visibleRange = { from: to - newSpan, to };
      void h.data.maybeLoadMoreHistory();
      h.requestPaint();
      h.engine.announce("Zoomed out.");
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const dir = e.key === "ArrowLeft" ? -1 : 1;
      const shift = span * 0.08 * dir;
      h.context.visibleRange = { from: from + shift, to: to + shift };
      void h.data.maybeLoadMoreHistory();
      h.requestPaint();
      h.engine.announce(dir < 0 ? "Panned left." : "Panned right.");
      e.preventDefault();
    }
  }
};

// src/engine/ChartRenderer.ts
var ChartRenderer = class {
  constructor(context, engine, shapes, data, studies) {
    this.context = context;
    this.engine = engine;
    this.shapes = shapes;
    this.data = data;
    this.studies = studies;
    this.crosshair = { x: 0, y: 0, active: false };
    this.plotL = 0;
    this.plotT = 0;
    this.plotW = 0;
    this.plotH = 0;
    this.subPanes = [];
    this.priceAxisW = PRICE_AXIS_W_DEFAULT;
    this.priceMin = 0;
    this.priceMax = 1;
    this.hoverShapeId = null;
    this.hoverMark = null;
    this.lastPointerType = "mouse";
    this.onToolDone = null;
    this.draft = null;
    this.markScreen = [];
    this.shapeScreen = [];
    this.pctBase = 1;
    this.seriesBars = [];
    this.canvas = engine.canvas;
    this.gestures = new GestureController(this);
    this.onData = () => this.engine.markDirty();
  }
  get selectedShapeId() {
    return this.context.selectedShapeId;
  }
  requestPaint() {
    this.engine.markDirty();
  }
  setToolDoneHandler(fn) {
    this.onToolDone = fn;
  }
  attach() {
    this.engine.paintHook = (ctx) => this.render(ctx);
    this.context.dataChanged.subscribe(null, this.onData);
    this.gestures.attach();
  }
  destroy() {
    this.context.dataChanged.unsubscribe(null, this.onData);
    this.gestures.destroy();
    this.engine.paintHook = null;
  }
  fitContent() {
    const n = this.context.bars.length;
    this.context.priceRange = null;
    this.context.autoScalePrice = true;
    if (n) {
      const count = Math.min(n, 120);
      this.context.visibleRange = {
        from: n - count,
        to: n - 1 + Math.max(2, Math.floor(count * 0.08))
      };
    }
    this.engine.markDirty();
  }
  takeScreenshot() {
    try {
      this.canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `raze-chart-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    } catch {
    }
  }
  cancelDraft() {
    this.draft = null;
    this.engine.markDirty();
  }
  plotScale() {
    return {
      plotL: this.plotL,
      plotT: this.plotT,
      plotW: this.plotW,
      plotH: this.plotH,
      priceMin: this.priceMin,
      priceMax: this.priceMax,
      pctBase: this.pctBase,
      visibleRange: this.context.visibleRange,
      percentScale: this.context.percentScale,
      logScale: this.context.logScale
    };
  }
  financeView() {
    const s = this.plotScale();
    return {
      ...s,
      context: this.context,
      cssWidth: this.engine.cssWidth,
      cssHeight: this.engine.cssHeight,
      priceAxisW: this.priceAxisW,
      subPanes: this.subPanes,
      seriesBars: this.seriesBars,
      studies: this.studies,
      shapes: this.shapes,
      markScreen: this.markScreen,
      shapeScreen: this.shapeScreen,
      crosshair: this.crosshair,
      hoverMark: this.hoverMark,
      draft: this.draft,
      selectedShapeId: this.context.selectedShapeId,
      fontFamily: this.context.fontFamily
    };
  }
  timePriceAt(x, y) {
    return this.gestures.timePriceAt(x, y);
  }
  timePriceAtEvent(e) {
    const { x, y } = this.gestures.pointerXY(e);
    return this.timePriceAt(x, y);
  }
  refreshSeriesBars() {
    if (this.context.chartStyle === "heikin_ashi") {
      this.seriesBars = heikinAshi(this.context.bars);
    } else {
      this.seriesBars = this.context.bars;
    }
  }
  render(ctx) {
    const W = this.engine.cssWidth;
    const H = this.engine.cssHeight;
    if (W <= 0 || H <= 0) return;
    const layout = computePlotLayout(W, H, this.priceAxisW, this.studies.paneDefs());
    this.plotL = layout.plotL;
    this.plotT = layout.plotT;
    this.plotW = layout.plotW;
    this.plotH = layout.plotH;
    this.subPanes = layout.subPanes;
    this.refreshSeriesBars();
    const bars = this.seriesBars.length ? this.seriesBars : this.context.bars;
    const fitted = autoFitPriceRange(
      bars,
      this.plotScale(),
      this.context.autoScalePrice,
      this.context.priceRange
    );
    this.pctBase = fitted.pctBase;
    this.priceMin = fitted.priceMin;
    this.priceMax = fitted.priceMax;
    const v = this.financeView();
    const priceTicks = computePriceTicks(v);
    const timeTicks = computeTimeTicks(this.context.bars, v);
    const desired = adjustPriceAxisWidth(ctx, v, priceTicks);
    if (Math.abs(desired - this.priceAxisW) > 1) {
      this.priceAxisW = desired;
      this.engine.markDirty();
    }
    paintFinanceScene(ctx, v, priceTicks, timeTicks);
    if (window.__RAZE_DEBUG) {
      const all = this.context.bars;
      let nonzero = 0, firstReal = -1, lastReal = -1;
      for (let i = 0; i < all.length; i++) {
        if (all[i].close > 0) {
          nonzero++;
          if (firstReal < 0) firstReal = i;
          lastReal = i;
        }
      }
      window.__razeChartState = {
        bars: all.length,
        nonzero,
        firstReal,
        lastReal,
        visibleRange: { ...this.context.visibleRange },
        priceMin: this.priceMin,
        priceMax: this.priceMax,
        firstBarClose: all[0]?.close,
        lastBarClose: all[all.length - 1]?.close,
        studies: this.studies.list().map((s) => ({ id: s.id, name: s.name, length: s.length })),
        crosshair: { ...this.crosshair }
      };
    }
  }
};

// src/ui/popup.ts
var popupId = 0;
function isCoarsePointer() {
  try {
    if (typeof window === "undefined") return false;
    if (window.matchMedia?.("(pointer: coarse)").matches) return true;
    if (window.matchMedia?.("(any-pointer: coarse)").matches) return true;
    return (navigator.maxTouchPoints ?? 0) > 0;
  } catch {
    return false;
  }
}
function ensureBaseStyles() {
  if (typeof document === "undefined" || document.getElementById("raze-chart-base-css")) return;
  const style = document.createElement("style");
  style.id = "raze-chart-base-css";
  style.textContent = ".raze-chart-left-sidebar{scrollbar-width:none}.raze-chart-left-sidebar::-webkit-scrollbar{display:none}.raze-chart-toolbar-scroll{scrollbar-width:none}.raze-chart-toolbar-scroll::-webkit-scrollbar{display:none}.raze-chart-focusable:focus{outline:none}.raze-chart-focusable:focus-visible{outline:2px solid var(--tv-color-toolbar-button-text-hover,#2962ff);outline-offset:1px}@media (forced-colors:active){.raze-chart-focusable:focus-visible{outline-color:Highlight}}@media (prefers-reduced-motion:reduce){.raze-chart-loading-screen{transition:none!important}.raze-chart-loading-spinner{animation:none!important}}";
  document.head.appendChild(style);
}
function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  return target.isContentEditable;
}
function popupItems(el) {
  return Array.from(el.querySelectorAll(
    '[role="menuitem"]:not([aria-disabled="true"]),[role="menuitemcheckbox"]:not([aria-disabled="true"]),[role="menuitemradio"]:not([aria-disabled="true"]),button:not([disabled])'
  )).filter((item, index, all) => all.indexOf(item) === index);
}
function openPopup(opts) {
  const el = document.createElement("div");
  el.id = `raze-chart-popup-${++popupId}`;
  if (opts.className) el.className = opts.className;
  el.setAttribute("role", opts.role ?? "menu");
  el.setAttribute("aria-label", opts.label ?? "Chart menu");
  if ((opts.role ?? "menu") === "menu") el.setAttribute("aria-orientation", "vertical");
  el.tabIndex = -1;
  el.style.cssText = [
    "position:fixed",
    `min-width:${opts.minWidth ?? 140}px`,
    `padding:${opts.padding ?? "4px 0"}`,
    "border-radius:6px",
    "border:1px solid var(--tv-color-toolbar-divider-background, #363a45)",
    "background:var(--tv-color-popup-background, var(--tv-color-pane-background, #1e222d))",
    "box-shadow:0 12px 24px -10px rgba(0,0,0,0.6)",
    "z-index:2147483640",
    `font-family:${opts.fontFamily}`,
    "font-size:12px",
    "color:var(--tv-color-popup-element-text, #d1d4dc)"
  ].join(";");
  const activeElement = document.activeElement;
  const returnFocus = opts.anchor ?? (activeElement instanceof HTMLElement ? activeElement : null);
  if (opts.anchor) {
    opts.anchor.setAttribute("aria-haspopup", opts.role ?? "menu");
    opts.anchor.setAttribute("aria-expanded", "true");
    opts.anchor.setAttribute("aria-controls", el.id);
  }
  document.body.appendChild(el);
  const focusItem = (index = 0) => {
    const items = popupItems(el);
    if (!items.length) {
      el.focus({ preventScroll: true });
      return;
    }
    const safeIndex = Math.max(0, Math.min(items.length - 1, index));
    items[safeIndex]?.focus({ preventScroll: true });
  };
  const reposition = () => {
    let left = opts.x ?? 0;
    let top = opts.y ?? 0;
    const pw = el.offsetWidth || opts.minWidth || 140;
    const ph = el.offsetHeight || 100;
    if (opts.anchor) {
      const r = opts.anchor.getBoundingClientRect();
      if ((opts.place ?? "right-start") === "right-start") {
        left = r.right + 6;
        top = r.top;
        if (left + pw > window.innerWidth - 8) left = Math.max(8, r.left - pw - 6);
      } else {
        left = r.left;
        top = r.bottom + 4;
        if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
      }
    } else if (left + pw > window.innerWidth - 4) {
      left = Math.max(4, window.innerWidth - pw - 4);
    }
    if (top + ph > window.innerHeight - 8) top = Math.max(8, window.innerHeight - ph - 8);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };
  let closed = false;
  const close = (options) => {
    if (closed) return;
    closed = true;
    document.removeEventListener("pointerdown", onAway, true);
    document.removeEventListener("keydown", onKey, true);
    el.removeEventListener("keydown", onMenuKey);
    el.removeEventListener("focusout", onFocusOut);
    el.remove();
    if (opts.anchor) {
      opts.anchor.setAttribute("aria-expanded", "false");
      if (opts.anchor.getAttribute("aria-controls") === el.id) {
        opts.anchor.removeAttribute("aria-controls");
      }
    }
    opts.onClose?.();
    if (options?.restoreFocus !== false && returnFocus?.isConnected) {
      returnFocus.focus({ preventScroll: true });
    }
  };
  const onAway = (e) => {
    const target = e.target;
    if (!(target instanceof Node)) return;
    if (el.contains(target)) return;
    if (opts.anchor?.contains(target)) return;
    close({ restoreFocus: false });
  };
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    if (!el.contains(document.activeElement) && document.activeElement !== opts.anchor) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  const onMenuKey = (e) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    if (isEditableTarget(e.target)) return;
    const items = popupItems(el);
    if (!items.length) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const current2 = focused ? items.indexOf(focused) : -1;
    let next = current2;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "ArrowDown") next = current2 < 0 ? 0 : (current2 + 1) % items.length;
    else next = current2 < 0 ? items.length - 1 : (current2 - 1 + items.length) % items.length;
    e.preventDefault();
    items[next]?.focus();
  };
  const onFocusOut = () => {
    queueMicrotask(() => {
      if (closed || el.contains(document.activeElement) || document.activeElement === opts.anchor) return;
      close({ restoreFocus: false });
    });
  };
  el.addEventListener("keydown", onMenuKey);
  el.addEventListener("focusout", onFocusOut);
  window.setTimeout(() => {
    if (closed) return;
    document.addEventListener("pointerdown", onAway, true);
    document.addEventListener("keydown", onKey, true);
    if (opts.initialFocus !== false) focusItem();
  }, 0);
  reposition();
  return { el, close, reposition, focusItem };
}
function popupRow(html, onClick, options) {
  const row = document.createElement("button");
  row.type = "button";
  row.innerHTML = html;
  row.className = "raze-chart-focusable";
  row.setAttribute("role", options?.role ?? "menuitem");
  if (options?.checked !== void 0) row.setAttribute("aria-checked", String(options.checked));
  if (options?.label) row.setAttribute("aria-label", options.label);
  for (const svg of row.querySelectorAll("svg")) {
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
  }
  row.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:8px",
    "width:100%",
    "border:0",
    "background:transparent",
    "color:inherit",
    isCoarsePointer() ? "padding:12px 14px" : "padding:7px 12px",
    "cursor:pointer",
    "text-align:left",
    "font:inherit",
    "border-radius:3px",
    "white-space:nowrap",
    "box-sizing:border-box",
    "touch-action:manipulation"
  ].join(";");
  row.addEventListener("mouseenter", () => {
    row.style.background = "var(--tv-color-popup-element-background-hover, rgba(255,255,255,0.08))";
  });
  row.addEventListener("mouseleave", () => {
    row.style.background = "transparent";
  });
  row.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return row;
}
function enableToolbarKeyboardNavigation(toolbar, orientation) {
  const onKey = (e) => {
    const previousKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    const nextKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    if (![previousKey, nextKey, "Home", "End"].includes(e.key)) return;
    const controls = Array.from(toolbar.querySelectorAll(
      'button:not([disabled]),[role="button"][tabindex]:not([aria-disabled="true"])'
    ));
    if (!controls.length) return;
    const target = e.target instanceof Element ? e.target.closest('button,[role="button"]') : null;
    const current2 = target ? controls.indexOf(target) : -1;
    if (current2 < 0) return;
    let next = current2;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = controls.length - 1;
    else if (e.key === nextKey) next = (current2 + 1) % controls.length;
    else next = (current2 - 1 + controls.length) % controls.length;
    e.preventDefault();
    controls[next]?.focus();
  };
  toolbar.addEventListener("keydown", onKey);
  return () => toolbar.removeEventListener("keydown", onKey);
}

// src/ui/Toolbar.ts
var TOOLBAR_HEIGHT = 38;
var Toolbar = class {
  constructor(context) {
    this.context = context;
    this.el = document.createElement("div");
    this.el.className = "raze-chart-toolbar";
    this.el.setAttribute("role", "toolbar");
    this.el.setAttribute("aria-label", "Chart toolbar");
    this.el.setAttribute("aria-orientation", "horizontal");
    this.el.style.cssText = [
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      `height:${TOOLBAR_HEIGHT}px`,
      "min-height:" + TOOLBAR_HEIGHT + "px",
      "padding:0 6px",
      "box-sizing:border-box",
      "border-bottom:1px solid var(--tv-color-toolbar-divider-background, #363a45)",
      "background:var(--tv-color-toolbar-button-background, transparent)",
      "color:var(--tv-color-toolbar-button-text, #d1d4dc)",
      `font-family:${this.context.fontFamily}`,
      "font-size:13px",
      "user-select:none",
      "overflow:visible",
      "position:relative",
      "z-index:3"
    ].join(";");
    const mkSlot = (justify) => {
      const s = document.createElement("div");
      s.style.cssText = `display:flex;align-items:center;gap:2px;justify-content:${justify};`;
      return s;
    };
    this.leftSlot = mkSlot("flex-start");
    this.leftSlot.className = "raze-chart-toolbar-scroll";
    this.leftSlot.style.cssText += ";min-width:0;flex:1 1 auto;overflow-x:auto;overflow-y:hidden;";
    this.rightSlot = mkSlot("flex-end");
    this.rightSlot.style.flex = "0 0 auto";
    this.intervalSlot = mkSlot("flex-start");
    this.intervalSlot.style.flex = "0 0 auto";
    this.intervalSlot.setAttribute("role", "group");
    this.intervalSlot.setAttribute("aria-label", "Chart interval");
    this.leftSlot.appendChild(this.intervalSlot);
    this.el.appendChild(this.leftSlot);
    this.el.appendChild(this.rightSlot);
    this.removeKeyboardNavigation = enableToolbarKeyboardNavigation(this.el, "horizontal");
  }
  createButton(options) {
    const align = options?.align === "right" ? "right" : "left";
    const useTv = options?.useTradingViewStyle !== false;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "raze-chart-toolbar-btn raze-chart-focusable";
    btn.style.cssText = [
      "appearance:none",
      "border:0",
      "margin:0",
      "padding:0",
      "background:transparent",
      "color:inherit",
      "font:inherit",
      "text-align:inherit"
    ].join(";");
    if (useTv) {
      btn.style.cssText = [
        "display:flex",
        "align-items:center",
        isCoarsePointer() ? "height:32px" : "height:26px",
        "padding:0 8px",
        "margin:0 1px",
        "border-radius:4px",
        "cursor:pointer",
        "white-space:nowrap",
        "color:var(--tv-color-toolbar-button-text, #d1d4dc)",
        "background:transparent",
        "touch-action:manipulation",
        "border:0",
        "font:inherit",
        "appearance:none"
      ].join(";");
      btn.addEventListener("mouseenter", () => {
        btn.style.background = "var(--tv-color-toolbar-button-background-hover, rgba(255,255,255,0.06))";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.background = "transparent";
      });
    } else {
      btn.style.display = "block";
    }
    if (options?.title) {
      btn.title = options.title;
      btn.setAttribute("aria-label", options.title);
    }
    (align === "right" ? this.rightSlot : this.leftSlot).appendChild(btn);
    return btn;
  }
  destroy() {
    this.removeKeyboardNavigation();
    this.el.remove();
  }
};

// src/ui/IntervalSelector.ts
var DEFAULT_INTERVAL_FAVORITES = ["1S", "1", "5", "15", "60", "240", "1D"];
var IntervalSelector = class {
  constructor(context, mount, onSelect, favorites) {
    this.context = context;
    this.mount = mount;
    this.onSelect = onSelect;
    this.buttons = /* @__PURE__ */ new Map();
    this.favorites = favorites && favorites.length ? favorites.map(String) : DEFAULT_INTERVAL_FAVORITES;
    this.active = String(context.resolution);
    this.mount.setAttribute("role", "group");
    this.mount.setAttribute("aria-label", "Chart interval");
    this.render();
  }
  supported() {
    const sr = this.context.symbolInfo?.supported_resolutions;
    const values = sr && sr.length ? sr.map(String) : this.favorites;
    return Array.from(new Set(values));
  }
  ordered() {
    return this.supported().slice().sort((a, b) => parseResolution(a).ms - parseResolution(b).ms);
  }
  render() {
    this.mount.innerHTML = "";
    this.buttons.clear();
    for (const res of this.ordered()) {
      this.mount.appendChild(this.makeButton(res));
    }
    this.repaint();
  }
  makeButton(res) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "raze-chart-focusable";
    b.textContent = resolutionLabel(res);
    b.setAttribute("aria-label", `Interval ${resolutionLabel(res)}`);
    b.style.cssText = this.btnCss();
    b.addEventListener("click", () => this.select(res));
    b.addEventListener("mouseenter", () => {
      if (res !== this.active) b.style.background = "var(--tv-color-toolbar-button-background-hover, rgba(255,255,255,0.06))";
    });
    b.addEventListener("mouseleave", () => {
      if (res !== this.active) b.style.background = "transparent";
    });
    this.buttons.set(res, b);
    return b;
  }
  btnCss() {
    const coarse = isCoarsePointer();
    return [
      "display:flex",
      "align-items:center",
      "justify-content:center",
      coarse ? "height:30px" : "height:24px",
      coarse ? "padding:0 10px" : "padding:0 7px",
      "margin:0 1px",
      "border-radius:4px",
      "cursor:pointer",
      "font-size:12px",
      "font-family:inherit",
      "line-height:normal",
      "color:var(--tv-color-toolbar-button-text, #d1d4dc)",
      "background:transparent",
      "border:0",
      "appearance:none",
      "touch-action:manipulation",
      "flex:0 0 auto"
    ].join(";");
  }
  select(res) {
    if (res === this.active) return;
    this.setActive(res);
    this.onSelect(res);
  }
  /** Reflect an externally-driven resolution change (no callback). */
  setActive(res) {
    this.active = res;
    if (!this.buttons.has(res)) {
      this.render();
      return;
    }
    this.repaint();
  }
  /** Re-render when the symbol (and its supported_resolutions) changes. */
  refresh() {
    this.render();
  }
  repaint() {
    for (const [res, b] of this.buttons) {
      const on = res === this.active;
      b.setAttribute("aria-pressed", String(on));
      if (on) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
      b.style.background = on ? "var(--tv-color-toolbar-button-background-active, rgba(255,255,255,0.1))" : "transparent";
      b.style.color = on ? "var(--tv-color-toolbar-button-text-hover, #fff)" : "var(--tv-color-toolbar-button-text, #d1d4dc)";
      b.style.fontWeight = on ? "600" : "400";
    }
  }
  destroy() {
  }
};

// src/ui/LoadingScreen.ts
var LoadingScreen = class {
  constructor(opts, fallbackBg) {
    const bg = opts?.backgroundColor ?? fallbackBg;
    const fg = opts?.foregroundColor ?? "#2962ff";
    this.el = document.createElement("div");
    this.el.className = "raze-chart-loading-screen";
    this.el.setAttribute("role", "status");
    this.el.setAttribute("aria-live", "polite");
    this.el.setAttribute("aria-atomic", "true");
    this.el.setAttribute("aria-busy", "true");
    this.el.setAttribute("aria-label", "Loading chart data");
    this.el.style.cssText = [
      "position:absolute",
      "inset:0",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      `background:${bg}`,
      "z-index:5",
      "transition:opacity 160ms ease",
      "opacity:1"
    ].join(";");
    this.spinner = document.createElement("div");
    this.spinner.className = "raze-chart-loading-spinner";
    this.spinner.setAttribute("aria-hidden", "true");
    this.spinner.style.cssText = [
      "width:28px",
      "height:28px",
      "border-radius:50%",
      `border:3px solid ${fg}`,
      "border-top-color:transparent",
      "animation:raze-chart-spin 0.8s linear infinite"
    ].join(";");
    this.el.appendChild(this.spinner);
    if (!document.getElementById("raze-chart-spin-kf")) {
      const style = document.createElement("style");
      style.id = "raze-chart-spin-kf";
      style.textContent = "@keyframes raze-chart-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.raze-chart-loading-spinner{animation:none!important}}";
      document.head.appendChild(style);
    }
  }
  hide() {
    this.el.setAttribute("aria-busy", "false");
    this.el.setAttribute("aria-label", "Chart data loaded");
    this.el.style.opacity = "0";
    window.setTimeout(() => this.el.remove(), 200);
  }
  destroy() {
    this.el.remove();
  }
};

// src/ui/IndicatorsMenu.ts
var DEFAULT_INDICATOR_PRESETS = [
  { label: "EMA 9", name: "EMA", length: 9, color: "#f5a623" },
  { label: "EMA 21", name: "EMA", length: 21, color: "#26a69a" },
  { label: "SMA 20", name: "SMA", length: 20, color: "#2962ff" },
  { label: "SMA 50", name: "SMA", length: 50, color: "#e040fb" },
  { label: "RSI 14", name: "RSI", length: 14, color: "#7E57C2" }
];
function resolveIndicatorPresets(raze, registry) {
  const source = raze?.indicator_presets ?? [
    ...DEFAULT_INDICATOR_PRESETS,
    ...(raze?.custom_studies ?? []).map((d) => ({ name: d.name }))
  ];
  const out = [];
  for (const p of source) {
    const def = registry.resolve(p.name);
    if (!def) {
      console.warn(`[raze-charts] indicator preset references unknown study: ${p.name}`);
      continue;
    }
    const length = Math.max(1, Math.floor(p.length ?? def.defaults?.length ?? 14));
    out.push({
      label: p.label ?? `${def.name} ${length}`,
      name: def.name,
      length,
      color: p.color ?? def.defaults?.color ?? "#f5a623"
    });
  }
  return out;
}
var IndicatorsMenu = class {
  constructor(context, studies, presets) {
    this.context = context;
    this.studies = studies;
    this.popup = null;
    this.anchor = null;
    this.presets = presets ?? resolveIndicatorPresets(void 0, studies.registry);
  }
  /** Toggle the panel anchored to a sidebar (or any) button. */
  toggle(anchor) {
    if (this.popup && this.anchor === anchor) {
      this.close();
      return;
    }
    this.close();
    this.open(anchor);
  }
  open(anchor) {
    this.anchor = anchor;
    anchor.setAttribute("aria-haspopup", "menu");
    anchor.setAttribute("aria-expanded", "false");
    const popup = openPopup({
      fontFamily: this.context.fontFamily,
      className: "raze-chart-indicators-menu",
      minWidth: 168,
      padding: "6px 0",
      anchor,
      place: "right-start",
      role: "menu",
      label: "Indicators",
      onClose: () => {
        if (this.popup === popup) {
          this.popup = null;
          this.anchor = null;
        }
      }
    });
    this.popup = popup;
    this.renderRows(popup.el);
    popup.reposition();
  }
  renderRows(panel, focusIndex) {
    panel.replaceChildren();
    const activeKey = new Set(
      this.studies.list().map((s) => `${s.name}:${s.length}`)
    );
    for (const [index, p] of this.presets.entries()) {
      const on = activeKey.has(`${p.name}:${p.length}`);
      const row = popupRow("", () => {
        if (on) {
          for (const s of this.studies.list()) {
            if (s.name === p.name && s.length === p.length) this.studies.remove(s.id);
          }
        } else {
          this.studies.add({ name: p.name, length: p.length, color: p.color });
        }
        this.renderRows(panel, index);
      }, { role: "menuitemcheckbox", checked: on, label: p.label });
      row.style.fontWeight = on ? "600" : "400";
      const swatch = document.createElement("span");
      swatch.setAttribute("aria-hidden", "true");
      swatch.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};flex:0 0 auto;`;
      row.append(swatch, document.createTextNode(on ? `\u2713 ${p.label}` : p.label));
      panel.appendChild(row);
    }
    const clear = popupRow("Clear all", () => {
      this.studies.clear();
      this.close();
    }, { role: "menuitem", label: "Clear all indicators" });
    clear.style.cssText += "border-top:1px solid var(--tv-color-toolbar-divider-background, #363a45);border-radius:0;color:#8b887e;margin-top:4px;padding:8px 12px;";
    panel.appendChild(clear);
    if (focusIndex !== void 0) this.popup?.focusItem(focusIndex);
  }
  close() {
    this.popup?.close();
    this.popup = null;
    this.anchor = null;
  }
  destroy() {
    this.close();
  }
};

// src/ui/LeftSidebar.ts
var LEFT_SIDEBAR_W = 42;
var ICON = {
  cursor: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 2.5L4 14.5L7.2 11.2L9.1 15.5L11 14.7L9.1 10.4L13.5 10.4L4 2.5Z" fill="currentColor"/></svg>`,
  trend: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 14L8 8L11 11L15 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="15" cy="4" r="1.4" fill="currentColor"/><circle cx="3" cy="14" r="1.4" fill="currentColor"/></svg>`,
  hline: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 9H16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M9 5V13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.35"/></svg>`,
  fib: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 3.5H15M3 7H15M3 11H15M3 14.5H15" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3 3.5V14.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  rect: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="3.5" y="4.5" width="11" height="9" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>`,
  text: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 4.5H14M9 4.5V14.5M6.5 14.5H11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  indicators: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 12.5L6.5 8.5L9.5 11L15 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 14.5H15" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.4"/></svg>`,
  fit: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 6V3.5H6M12 3.5H15V6M15 12V14.5H12M6 14.5H3V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  camera: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2.5" y="5" width="13" height="9.5" rx="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="9" cy="9.5" r="2.4" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 5L7.5 3.5H10.5L11.5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  fullscreen: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 6.5V3.5H6M12 3.5H15V6.5M15 11.5V14.5H12M6 14.5H3V11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  candles: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M5 3V15M5 6H7V12H3V6H5ZM13 3V15M13 5H15V11H11V5H13Z" fill="currentColor"/></svg>`
};
var TOOL_IDS = /* @__PURE__ */ new Set([
  "cursor",
  "trend_line",
  "horizontal_line",
  "fib_retracement",
  "rectangle",
  "text"
]);
var BUILTIN = {
  cursor: { title: "Cursor / pan", svg: ICON.cursor },
  trend_line: { title: "Trend line", svg: ICON.trend },
  horizontal_line: { title: "Horizontal line", svg: ICON.hline },
  fib_retracement: { title: "Fib retracement", svg: ICON.fib },
  rectangle: { title: "Rectangle", svg: ICON.rect },
  text: { title: "Text", svg: ICON.text },
  indicators: { title: "Indicators", svg: ICON.indicators },
  fit: { title: "Fit content (F)", svg: ICON.fit },
  screenshot: { title: "Screenshot", svg: ICON.camera },
  fullscreen: { title: "Fullscreen", svg: ICON.fullscreen },
  chart_type: { title: "Chart type", svg: ICON.candles }
};
var DEFAULT_SIDEBAR_ITEMS = [
  "cursor",
  "trend_line",
  "horizontal_line",
  "fib_retracement",
  "rectangle",
  "text",
  "separator",
  "indicators",
  "separator",
  "fit",
  "screenshot",
  "fullscreen",
  "separator",
  "chart_type"
];
var ALL_CHART_STYLES = [
  { id: "candles", title: "Candles", svg: ICON.candles },
  {
    id: "line",
    title: "Line",
    svg: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2.5 12.5L6.5 7.5L10 10.5L15.5 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  },
  {
    id: "area",
    title: "Area",
    svg: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2.5 13.5L6.5 8L10 11L15.5 4.5V13.5H2.5Z" fill="currentColor" opacity="0.35"/><path d="M2.5 13.5L6.5 8L10 11L15.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  },
  {
    id: "heikin_ashi",
    title: "Heikin Ashi",
    svg: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="4" y="5" width="4" height="8" rx="0.5" fill="currentColor"/><rect x="10" y="3" width="4" height="10" rx="0.5" fill="currentColor" opacity="0.55"/></svg>`
  }
];
var LeftSidebar = class {
  constructor(context, cbs, items = DEFAULT_SIDEBAR_ITEMS, chartTypes) {
    this.context = context;
    this.cbs = cbs;
    this.toolBtns = /* @__PURE__ */ new Map();
    this.styleBtn = null;
    this.stylePanel = null;
    this.activeTool = "cursor";
    this.chartStyle = "candles";
    this.chartStyles = chartTypes ? ALL_CHART_STYLES.filter((s) => chartTypes.includes(s.id)) : ALL_CHART_STYLES;
    this.el = document.createElement("div");
    this.el.className = "raze-chart-left-sidebar";
    this.el.setAttribute("role", "toolbar");
    this.el.setAttribute("aria-label", "Drawing and chart tools");
    this.el.setAttribute("aria-orientation", "vertical");
    this.el.style.cssText = [
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      `width:${LEFT_SIDEBAR_W}px`,
      "min-width:" + LEFT_SIDEBAR_W + "px",
      "box-sizing:border-box",
      "padding:6px 0",
      "gap:2px",
      "border-right:1px solid var(--tv-color-toolbar-divider-background, #363a45)",
      "background:var(--tv-color-platform-background, #181615)",
      "color:var(--tv-color-toolbar-button-text, #d1d4dc)",
      "user-select:none",
      "z-index:2",
      // Short containers scroll the toolbar instead of clipping it (the
      // scrollbar itself is hidden via the injected base stylesheet).
      "overflow-y:auto",
      "overflow-x:visible",
      "position:relative"
    ].join(";");
    for (const item of items) {
      this.appendItem(item);
    }
    this.setTool("cursor");
    this.setChartStyle("candles");
    this.removeKeyboardNavigation = enableToolbarKeyboardNavigation(this.el, "vertical");
  }
  appendItem(item) {
    if (item === "separator") {
      this.addSep();
      return;
    }
    if (typeof item !== "string") {
      this.appendCustom(item);
      return;
    }
    const def = BUILTIN[item];
    if (!def) {
      console.warn(`[raze-charts] unknown sidebar item: ${item}`);
      return;
    }
    if (item === "chart_type") {
      this.styleBtn = this.mkBtn(def.title, def.svg);
      this.styleBtn.setAttribute("aria-haspopup", "menu");
      this.styleBtn.setAttribute("aria-expanded", "false");
      this.styleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.stylePanel) this.closeStylePanel();
        else this.openStylePanel();
      });
      this.el.appendChild(this.styleBtn);
      return;
    }
    const b = this.mkBtn(def.title, def.svg);
    this.toolBtns.set(item, b);
    if (item === "indicators") {
      b.setAttribute("aria-haspopup", "menu");
      b.setAttribute("aria-expanded", "false");
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cbs.onIndicatorsClick(b);
      });
    } else if (item === "fit") {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cbs.onFit();
      });
    } else if (item === "screenshot") {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cbs.onScreenshot();
      });
    } else if (item === "fullscreen") {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cbs.onFullscreen();
      });
    } else {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setTool(item);
        this.cbs.onTool(item);
      });
    }
    this.el.appendChild(b);
  }
  appendCustom(item) {
    const b = this.mkBtn(item.title, item.icon);
    b.dataset.customId = item.id;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      try {
        item.onClick();
      } catch (err) {
        console.warn(`[raze-charts] sidebar item "${item.id}" onClick failed`, err);
      }
    });
    this.toolBtns.set(item.id, b);
    this.el.appendChild(b);
  }
  mkBtn(title, svg) {
    const b = document.createElement("button");
    b.type = "button";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.className = "raze-chart-focusable";
    b.innerHTML = svg;
    for (const icon of b.querySelectorAll("svg")) {
      icon.setAttribute("aria-hidden", "true");
      icon.setAttribute("focusable", "false");
    }
    const size = isCoarsePointer() ? 38 : 32;
    b.style.cssText = [
      "display:flex",
      "align-items:center",
      "justify-content:center",
      `width:${size}px`,
      `height:${size}px`,
      "border:0",
      "border-radius:6px",
      "background:transparent",
      "color:inherit",
      "cursor:pointer",
      "padding:0",
      "flex:0 0 auto",
      "touch-action:manipulation"
    ].join(";");
    b.addEventListener("mouseenter", () => {
      if (b.dataset.active !== "1") b.style.background = "rgba(255,255,255,0.06)";
    });
    b.addEventListener("mouseleave", () => {
      if (b.dataset.active !== "1") b.style.background = "transparent";
    });
    return b;
  }
  addSep() {
    const s = document.createElement("div");
    s.setAttribute("role", "separator");
    s.setAttribute("aria-orientation", "horizontal");
    s.style.cssText = "width:22px;height:1px;background:var(--tv-color-toolbar-divider-background,#363a45);margin:4px 0;";
    this.el.appendChild(s);
  }
  setTool(tool) {
    this.activeTool = tool;
    for (const [id, b] of this.toolBtns) {
      if (!TOOL_IDS.has(id)) continue;
      const on = id === tool;
      b.setAttribute("aria-pressed", String(on));
      b.dataset.active = on ? "1" : "0";
      b.style.background = on ? "rgba(102,216,158,0.18)" : "transparent";
      b.style.color = on ? "#66d89e" : "inherit";
    }
  }
  getTool() {
    return this.activeTool;
  }
  setChartStyle(style) {
    this.chartStyle = style;
    if (!this.styleBtn) return;
    const def = this.chartStyles.find((s) => s.id === style) ?? ALL_CHART_STYLES.find((s) => s.id === style);
    if (!def) return;
    this.styleBtn.innerHTML = def.svg;
    this.styleBtn.title = `Chart type: ${def.title}`;
    this.styleBtn.setAttribute("aria-label", `Chart type: ${def.title}`);
    for (const icon of this.styleBtn.querySelectorAll("svg")) {
      icon.setAttribute("aria-hidden", "true");
      icon.setAttribute("focusable", "false");
    }
  }
  openStylePanel() {
    if (!this.styleBtn) return;
    const popup = openPopup({
      fontFamily: this.context.fontFamily,
      className: "raze-chart-style-menu",
      minWidth: 140,
      padding: "6px 0",
      anchor: this.styleBtn,
      place: "right-start",
      role: "menu",
      label: "Chart type",
      onClose: () => {
        if (this.stylePanel === popup) this.stylePanel = null;
      }
    });
    this.stylePanel = popup;
    for (const s of this.chartStyles) {
      const on = s.id === this.chartStyle;
      const row = popupRow(
        `<span style="display:inline-flex;width:18px;color:${on ? "#66d89e" : "inherit"}">${s.svg}</span>${on ? "\u2713 " : ""}${s.title}`,
        () => {
          this.setChartStyle(s.id);
          this.cbs.onChartType(s.id);
          this.closeStylePanel();
        },
        { role: "menuitemradio", checked: on, label: s.title }
      );
      popup.el.appendChild(row);
    }
    popup.reposition();
  }
  closeStylePanel() {
    this.stylePanel?.close();
    this.stylePanel = null;
  }
  destroy() {
    this.closeStylePanel();
    this.removeKeyboardNavigation();
    this.el.remove();
  }
};

// src/ui/ScaleBar.ts
var ScaleBar = class {
  constructor(context, onChange) {
    this.context = context;
    this.onChange = onChange;
    this.el = document.createElement("div");
    this.el.className = "raze-chart-scale-bar";
    this.el.setAttribute("role", "toolbar");
    this.el.setAttribute("aria-label", "Price scale");
    this.el.setAttribute("aria-orientation", "horizontal");
    this.el.style.cssText = [
      "position:absolute",
      "right:4px",
      "bottom:26px",
      "display:flex",
      "align-items:center",
      "gap:2px",
      "z-index:4",
      `font-family:${context.fontFamily}`,
      "font-size:11px",
      "user-select:none",
      "pointer-events:auto"
    ].join(";");
    this.pctBtn = this.mk("%", "Percent scale");
    this.logBtn = this.mk("log", "Logarithmic scale");
    this.autoBtn = this.mk("auto", "Auto-scale price (double-click axis)");
    this.pctBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.context.percentScale = !this.context.percentScale;
      if (this.context.percentScale) this.context.logScale = false;
      this.context.autoScalePrice = true;
      this.context.priceRange = null;
      this.sync();
      this.onChange();
    });
    this.logBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.context.logScale = !this.context.logScale;
      if (this.context.logScale) this.context.percentScale = false;
      this.context.autoScalePrice = true;
      this.context.priceRange = null;
      this.sync();
      this.onChange();
    });
    this.autoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.context.autoScalePrice = true;
      this.context.priceRange = null;
      this.sync();
      this.onChange();
    });
    this.el.append(this.pctBtn, this.logBtn, this.autoBtn);
    this.removeKeyboardNavigation = enableToolbarKeyboardNavigation(this.el, "horizontal");
    this.sync();
  }
  mk(label, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.className = "raze-chart-focusable";
    b.style.cssText = [
      "border:0",
      "border-radius:3px",
      isCoarsePointer() ? "padding:6px 10px" : "padding:2px 6px",
      "cursor:pointer",
      "background:transparent",
      "color:var(--tv-color-toolbar-button-text, #8b887e)",
      "font:inherit",
      "touch-action:manipulation"
    ].join(";");
    return b;
  }
  sync() {
    const set = (b, on) => {
      b.setAttribute("aria-pressed", String(on));
      b.style.color = on ? "#66d89e" : "var(--tv-color-toolbar-button-text, #8b887e)";
      b.style.background = on ? "rgba(102,216,158,0.14)" : "transparent";
      b.style.fontWeight = on ? "600" : "400";
    };
    set(this.pctBtn, this.context.percentScale);
    set(this.logBtn, this.context.logScale);
    set(this.autoBtn, this.context.autoScalePrice && !this.context.priceRange);
  }
  destroy() {
    this.removeKeyboardNavigation();
    this.el.remove();
  }
};

// src/studies/calc.ts
function sma(closes, length) {
  const out = new Array(closes.length).fill(null);
  if (length < 1 || closes.length < length) return out;
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= length) sum -= closes[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}
function ema(closes, length) {
  const out = new Array(closes.length).fill(null);
  if (length < 1 || closes.length < length) return out;
  let sum = 0;
  for (let i = 0; i < length; i++) sum += closes[i];
  let prev = sum / length;
  out[length - 1] = prev;
  const k = 2 / (length + 1);
  for (let i = length; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
function rsi(closes, length) {
  const out = new Array(closes.length).fill(null);
  if (length < 1 || closes.length < length + 1) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= length;
  avgLoss /= length;
  out[length] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = length + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (length - 1) + gain) / length;
    avgLoss = (avgLoss * (length - 1) + loss) / length;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}
function closesFromBars(bars) {
  return bars.map((b) => b.close > 0 ? b.close : b.open);
}

// src/studies/registry.ts
var BUILTIN_STUDIES = [
  {
    name: "EMA",
    aliases: ["moving average exponential"],
    keywords: ["exponential"],
    pane: "overlay",
    defaults: { length: 9, color: "#f5a623" },
    compute: (bars, { length }) => ema(closesFromBars(bars), length)
  },
  {
    name: "SMA",
    aliases: ["ma", "moving average"],
    keywords: ["simple moving"],
    pane: "overlay",
    defaults: { length: 20, color: "#2962ff" },
    compute: (bars, { length }) => sma(closesFromBars(bars), length)
  },
  {
    name: "RSI",
    aliases: ["relative strength index"],
    keywords: ["relative strength"],
    pane: "pane",
    defaults: { length: 14, color: "#7E57C2" },
    range: { min: 0, max: 100 },
    levels: [
      { value: 30, axisLabel: true },
      { value: 50, dashed: true },
      { value: 70, axisLabel: true }
    ],
    formatValue: (v) => v.toFixed(1),
    compute: (bars, { length }) => rsi(closesFromBars(bars), length)
  }
];
var StudyRegistry = class {
  constructor(defs = BUILTIN_STUDIES) {
    this.defs = [];
    for (const d of defs) this.register(d);
  }
  /** Add or replace (by case-insensitive name) a study definition. */
  register(def) {
    if (!def || typeof def.name !== "string" || !def.name.trim() || typeof def.compute !== "function") {
      console.warn("[raze-charts] ignoring invalid study definition", def);
      return;
    }
    const key = def.name.toLowerCase();
    this.defs = this.defs.filter((d) => d.name.toLowerCase() !== key);
    this.defs.push(def);
  }
  list() {
    return [...this.defs];
  }
  /** Case-insensitive lookup: exact name/alias first, then keyword substring. */
  resolve(name) {
    const q = name.trim().toLowerCase();
    if (!q) return null;
    for (const d of this.defs) {
      if (d.name.toLowerCase() === q) return d;
      if ((d.aliases ?? []).some((a) => a.toLowerCase() === q)) return d;
    }
    for (const d of this.defs) {
      if ((d.keywords ?? []).some((k) => k && q.includes(k.toLowerCase()))) return d;
    }
    return null;
  }
};

// src/studies/StudyStore.ts
var FALLBACK_COLORS = ["#f5a623", "#26a69a", "#2962ff", "#e040fb", "#7E57C2"];
var BUILTIN_KINDS = /* @__PURE__ */ new Map();
for (const definition of BUILTIN_STUDIES) {
  const name = definition.name.toLowerCase();
  if (name === "ema" || name === "sma" || name === "rsi") {
    BUILTIN_KINDS.set(definition, { kind: name, compute: definition.compute });
  }
}
function fingerprint(bar) {
  if (!bar) return null;
  return {
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume
  };
}
function sameBar(bar, value) {
  if (!bar || !value) return !bar && !value;
  return bar.time === value.time && bar.open === value.open && bar.high === value.high && bar.low === value.low && bar.close === value.close && bar.volume === value.volume;
}
function closeOf(bar) {
  return bar.close > 0 ? bar.close : bar.open;
}
var seq = 0;
function nextId2(name) {
  seq += 1;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `study_${slug}_${seq}`;
}
var StudyStore = class {
  constructor(context, registry = new StudyRegistry()) {
    this.context = context;
    this.registry = registry;
    this.items = /* @__PURE__ */ new Map();
    this.runtimes = /* @__PURE__ */ new Map();
    this.subscriptionOwner = {};
    this.onDataChanged = () => this.handleDataChanged();
    this.barsSnapshot = this.captureBars();
    this.context.dataChanged.subscribe(
      this.subscriptionOwner,
      this.onDataChanged
    );
  }
  list() {
    return Array.from(this.items.values());
  }
  /** Distinct definitions of active sub-pane studies, in insertion order. */
  paneDefs() {
    const out = [];
    for (const s of this.items.values()) {
      if (s.def.pane === "pane" && !out.includes(s.def)) out.push(s.def);
    }
    return out;
  }
  /** Instances rendered in the sub-pane of `def`. */
  paneStudies(def) {
    return this.list().filter((s) => s.def === def);
  }
  /** Returns the new study id, or null when `spec.name` is not in the registry. */
  add(spec) {
    const def = this.registry.resolve(spec.name);
    if (!def) return null;
    const id = nextId2(def.name);
    const rawLength = spec.length || def.defaults?.length || 14;
    const study = {
      id,
      def,
      name: def.name,
      length: Math.max(1, Math.floor(rawLength)),
      color: spec.color || def.defaults?.color || FALLBACK_COLORS[this.items.size % FALLBACK_COLORS.length],
      values: []
    };
    const builtin = BUILTIN_KINDS.get(def);
    this.runtimes.set(id, {
      // The exported definitions are mutable for compatibility. Optimise only
      // while both object and calculator are still the canonical built-in.
      kind: builtin && builtin.compute === def.compute ? builtin.kind : null,
      rsi: null
    });
    this.recompute(study);
    this.items.set(id, study);
    this.context.requestPaint();
    return id;
  }
  remove(id) {
    if (!this.items.delete(id)) return false;
    this.runtimes.delete(id);
    this.context.requestPaint();
    return true;
  }
  clear() {
    if (this.items.size === 0) return;
    this.items.clear();
    this.runtimes.clear();
    this.context.requestPaint();
  }
  has(id) {
    return this.items.has(id);
  }
  handleDataChanged() {
    const mutation = this.classifyBarsMutation();
    this.barsSnapshot = this.captureBars();
    if (mutation === "none" || this.items.size === 0) return;
    for (const study of this.items.values()) {
      if ((mutation === "append" || mutation === "replace-last") && this.updateBuiltinLastValue(study, mutation)) {
        continue;
      }
      this.recompute(study);
    }
    this.context.requestPaint();
  }
  recompute(study) {
    try {
      const values = study.def.compute(this.context.bars, { length: study.length });
      study.values = Array.isArray(values) ? values : [];
      const runtime = this.runtimes.get(study.id);
      if (runtime) {
        runtime.rsi = runtime.kind === "rsi" ? this.buildRsiRuntime(study.length) : null;
      }
    } catch (e) {
      console.warn(`[raze-charts] study "${study.name}" compute failed`, e);
      study.values = [];
      const runtime = this.runtimes.get(study.id);
      if (runtime) runtime.rsi = null;
    }
  }
  /**
   * Update only the forming/new sample for built-ins whose recurrence is known.
   * Custom definitions intentionally keep using their public, full-array
   * `compute` contract; guessing their dependency window would be incorrect.
   */
  updateBuiltinLastValue(study, mutation) {
    const runtime = this.runtimes.get(study.id);
    if (!runtime?.kind) return false;
    const builtin = BUILTIN_KINDS.get(study.def);
    if (!builtin || builtin.compute !== study.def.compute) return false;
    const bars = this.context.bars;
    const n = bars.length;
    const previousLength = mutation === "append" ? n - 1 : n;
    if (n === 0 || study.values.length !== previousLength) return false;
    const index = n - 1;
    study.values.length = n;
    if (runtime.kind === "sma") {
      if (n < study.length) {
        study.values[index] = null;
        return true;
      }
      let sum = 0;
      for (let i = n - study.length; i < n; i++) sum += closeOf(bars[i]);
      study.values[index] = sum / study.length;
      return true;
    }
    if (runtime.kind === "ema") {
      if (index < study.length - 1) {
        study.values[index] = null;
        return true;
      }
      if (index === study.length - 1) {
        let sum = 0;
        for (let i = 0; i < study.length; i++) sum += closeOf(bars[i]);
        study.values[index] = sum / study.length;
        return true;
      }
      const previous = study.values[index - 1];
      if (typeof previous !== "number") return false;
      const weight = 2 / (study.length + 1);
      study.values[index] = closeOf(bars[index]) * weight + previous * (1 - weight);
      return true;
    }
    const rsi2 = runtime.rsi;
    if (!rsi2 || rsi2.avgGains.length !== previousLength || rsi2.avgLosses.length !== previousLength) {
      return false;
    }
    rsi2.avgGains.length = n;
    rsi2.avgLosses.length = n;
    if (index < study.length) {
      study.values[index] = null;
      rsi2.avgGains[index] = null;
      rsi2.avgLosses[index] = null;
      return true;
    }
    let avgGain;
    let avgLoss;
    if (index === study.length) {
      avgGain = 0;
      avgLoss = 0;
      for (let i = 1; i <= study.length; i++) {
        const delta = closeOf(bars[i]) - closeOf(bars[i - 1]);
        if (delta >= 0) avgGain += delta;
        else avgLoss -= delta;
      }
      avgGain /= study.length;
      avgLoss /= study.length;
    } else {
      const previousGain = rsi2.avgGains[index - 1];
      const previousLoss = rsi2.avgLosses[index - 1];
      if (typeof previousGain !== "number" || typeof previousLoss !== "number") return false;
      const delta = closeOf(bars[index]) - closeOf(bars[index - 1]);
      const gain = delta > 0 ? delta : 0;
      const loss = delta < 0 ? -delta : 0;
      avgGain = (previousGain * (study.length - 1) + gain) / study.length;
      avgLoss = (previousLoss * (study.length - 1) + loss) / study.length;
    }
    rsi2.avgGains[index] = avgGain;
    rsi2.avgLosses[index] = avgLoss;
    study.values[index] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    return true;
  }
  buildRsiRuntime(length) {
    const bars = this.context.bars;
    const avgGains = new Array(bars.length).fill(null);
    const avgLosses = new Array(bars.length).fill(null);
    if (bars.length < length + 1) return { avgGains, avgLosses };
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= length; i++) {
      const delta = closeOf(bars[i]) - closeOf(bars[i - 1]);
      if (delta >= 0) avgGain += delta;
      else avgLoss -= delta;
    }
    avgGain /= length;
    avgLoss /= length;
    avgGains[length] = avgGain;
    avgLosses[length] = avgLoss;
    for (let i = length + 1; i < bars.length; i++) {
      const delta = closeOf(bars[i]) - closeOf(bars[i - 1]);
      const gain = delta > 0 ? delta : 0;
      const loss = delta < 0 ? -delta : 0;
      avgGain = (avgGain * (length - 1) + gain) / length;
      avgLoss = (avgLoss * (length - 1) + loss) / length;
      avgGains[i] = avgGain;
      avgLosses[i] = avgLoss;
    }
    return { avgGains, avgLosses };
  }
  classifyBarsMutation() {
    const bars = this.context.bars;
    const before = this.barsSnapshot;
    if (bars !== before.ref) return "full";
    const n = bars.length;
    if (n === before.length) {
      if (sameBar(bars[0], before.first) && sameBar(bars[n - 2], before.penultimate) && sameBar(bars[n - 1], before.last)) {
        return "none";
      }
      if (n > 0 && sameBar(bars[0], before.first) && sameBar(bars[n - 2], before.penultimate) && bars[n - 1].time === before.last?.time) {
        return "replace-last";
      }
      return "full";
    }
    if (n === before.length + 1 && sameBar(bars[0], before.first) && sameBar(bars[n - 2], before.last)) {
      return "append";
    }
    return "full";
  }
  captureBars() {
    const bars = this.context.bars;
    return {
      ref: bars,
      length: bars.length,
      first: fingerprint(bars[0]),
      penultimate: fingerprint(bars[bars.length - 2]),
      last: fingerprint(bars[bars.length - 1])
    };
  }
  destroy() {
    this.context.dataChanged.unsubscribe(
      this.subscriptionOwner,
      this.onDataChanged
    );
    this.items.clear();
    this.runtimes.clear();
  }
};

// src/ui/ContextMenu.ts
var current = null;
function showContextMenu(x, y, items, fontFamily) {
  closeContextMenu();
  if (!items.length) return;
  const popup = openPopup({
    fontFamily,
    className: "raze-chart-context-menu",
    minWidth: 160,
    padding: "4px",
    x,
    y,
    role: "menu",
    label: "Chart context menu",
    onClose: () => {
      if (current === popup) current = null;
    }
  });
  current = popup;
  const top = items.filter((i) => i.position !== "bottom");
  const bottom = items.filter((i) => i.position === "bottom");
  const ordered = [...top, ...bottom];
  for (const [index, item] of ordered.entries()) {
    const row = popupRow(item.text, () => {
      closeContextMenu();
      try {
        item.click();
      } catch {
      }
    }, { role: "menuitem", label: item.text });
    row.setAttribute("aria-posinset", String(index + 1));
    row.setAttribute("aria-setsize", String(ordered.length));
    if (!isCoarsePointer()) row.style.padding = "6px 10px";
    row.textContent = item.text;
    popup.el.appendChild(row);
  }
  popup.reposition();
}
function closeContextMenu() {
  current?.close();
  current = null;
}

// src/core/Widget.ts
var DEFAULT_FONT = "'Trebuchet MS', Roboto, Ubuntu, sans-serif";
var Widget = class {
  constructor(options) {
    this.toolbar = null;
    this.leftSidebar = null;
    this.scaleBar = null;
    this.intervalSelector = null;
    this.indicatorsMenu = null;
    this.chartReady = new Delegate();
    this.isChartReady = false;
    this.subscriptions = /* @__PURE__ */ new Map();
    this.contextMenuCb = null;
    this.destroyed = false;
    this.compactRO = null;
    /** Only the newest imperative data change may run its completion callback. */
    this.dataChangeId = 0;
    this.headerReadySettled = false;
    const containerEl = typeof options.container === "string" ? document.getElementById(options.container) : options.container;
    if (!containerEl) throw new Error("[raze-charts] widget container not found");
    const fontFamily = options.custom_font_family || DEFAULT_FONT;
    const theme = buildTheme(options);
    const features = buildFeatureSet(options);
    const raze = options.raze;
    const showHeader = features.has("header_widget");
    const showLeftToolbar = features.has("left_toolbar");
    const initialRange = { from: 0, to: 1 };
    this.context = {
      options,
      datafeed: options.datafeed,
      locale: options.locale ?? "en",
      fontFamily,
      symbol: options.symbol,
      resolution: options.interval,
      symbolInfo: null,
      formatPrice: createPriceFormatter(options, null),
      theme,
      features,
      bars: [],
      marks: [],
      visibleRange: initialRange,
      autoScalePrice: true,
      priceRange: null,
      chartStyle: "candles",
      logScale: false,
      percentScale: false,
      drawingTool: "cursor",
      selectedShapeId: null,
      intervalChanged: new Delegate(),
      dataChanged: new Delegate(),
      drawingEvent: new Delegate(),
      requestPaint: () => {
      }
    };
    ensureBaseStyles();
    this.root = document.createElement("div");
    this.root.className = "raze-chart-root";
    this.root.style.cssText = [
      "position:relative",
      "width:100%",
      "height:100%",
      "display:flex",
      "flex-direction:column",
      "overflow:hidden",
      `background:${theme.paneBackground}`,
      `font-family:${fontFamily}`,
      "--tv-color-pane-background:" + theme.paneBackground,
      "--tv-color-platform-background:" + theme.paneBackground
    ].join(";");
    containerEl.appendChild(this.root);
    if (showHeader) {
      this.toolbar = new Toolbar(this.context);
      this.root.appendChild(this.toolbar.el);
    }
    this.bodyRow = document.createElement("div");
    this.bodyRow.style.cssText = "display:flex;flex:1 1 auto;min-height:0;overflow:hidden;position:relative;";
    this.root.appendChild(this.bodyRow);
    if (showLeftToolbar) {
      this.leftSidebar = new LeftSidebar(
        this.context,
        {
          onTool: (tool) => {
            this.context.drawingTool = tool;
            this.renderer.cancelDraft();
            this.leftSidebar?.setTool(tool);
            this.context.requestPaint();
          },
          onIndicatorsClick: (anchor) => {
            this.indicatorsMenu?.toggle(anchor);
          },
          onFit: () => this.renderer.fitContent(),
          onScreenshot: () => this.renderer.takeScreenshot(),
          onFullscreen: () => this.toggleFullscreen(),
          onChartType: (style) => {
            this.context.chartStyle = style;
            this.leftSidebar?.setChartStyle(style);
            this.context.autoScalePrice = true;
            this.context.priceRange = null;
            this.context.requestPaint();
          }
        },
        raze?.sidebar ?? DEFAULT_SIDEBAR_ITEMS,
        raze?.chart_types
      );
      this.bodyRow.appendChild(this.leftSidebar.el);
    }
    this.chartArea = document.createElement("div");
    this.chartArea.style.cssText = "position:relative;flex:1 1 auto;min-width:0;min-height:0;overflow:hidden;";
    this.bodyRow.appendChild(this.chartArea);
    this.data = new DataManager(this.context);
    this.shapes = new ShapeStore(this.context);
    const registry = new StudyRegistry();
    for (const def of raze?.custom_studies ?? []) registry.register(def);
    this.studies = new StudyStore(this.context, registry);
    this.engine = new ChartEngine(this.chartArea, this.context);
    this.syncAccessibility();
    this.renderer = new ChartRenderer(this.context, this.engine, this.shapes, this.data, this.studies);
    this.renderer.setToolDoneHandler((tool) => {
      this.context.drawingTool = tool;
      this.leftSidebar?.setTool(tool);
    });
    if (features.has("scale_bar")) {
      this.scaleBar = new ScaleBar(this.context, () => {
        this.scaleBar?.sync();
        this.context.requestPaint();
      });
      this.chartArea.appendChild(this.scaleBar.el);
    }
    this.loading = new LoadingScreen(options.loading_screen, theme.paneBackground);
    this.chartArea.appendChild(this.loading.el);
    this.indicatorsMenu = new IndicatorsMenu(
      this.context,
      this.studies,
      resolveIndicatorPresets(raze, registry)
    );
    const deps = {
      refreshMarks: () => this.data.refreshMarks(),
      clearMarks: () => this.data.clearMarks(),
      resetData: () => this.data.resetData(),
      setResolution: (res, cb) => {
        this.runDataChange(
          `change resolution to ${res}`,
          () => this.data.changeResolution(res),
          cb
        );
      },
      setSymbol: (sym, cb) => {
        this.runDataChange(
          `change symbol to ${sym}`,
          () => this.data.changeSymbol(sym),
          cb,
          () => this.intervalSelector?.refresh()
        );
      },
      createShape: (point, opts) => this.shapes.create(point, opts),
      createMultipointShape: (points, opts) => this.shapes.createPoints(points, opts),
      getShapeById: (id) => this.shapes.adapter(id),
      removeEntity: (id) => {
        if (this.studies.remove(id)) return;
        this.shapes.remove(id);
      },
      removeAllShapes: () => this.shapes.removeAll(),
      createStudy: (name, _force, _lock, inputs) => {
        const lengthRaw = inputs?.length ?? inputs?.Length ?? inputs?.periods;
        const length = typeof lengthRaw === "number" && Number.isFinite(lengthRaw) ? lengthRaw : 0;
        const color = typeof inputs?.color === "string" ? inputs.color : "";
        const id = this.studies.add({ name, length, color });
        if (!id) return Promise.reject(new Error(`[raze-charts] unknown study: ${name}`));
        return Promise.resolve(id);
      }
    };
    this.api = new ChartApi(this.context, deps);
    this.context.drawingEvent.subscribe(null, ((id, type) => {
      this.emit("drawing_event", id, type);
    }));
    this.headerReadyPromise = new Promise((resolve) => {
      this.headerReadyResolve = resolve;
    });
    this.renderer.attach();
    this.wireContextMenu();
    const compactBp = raze?.compact_breakpoint ?? 520;
    if (this.leftSidebar && compactBp > 0 && typeof ResizeObserver !== "undefined") {
      const sync = () => {
        const w = this.root.clientWidth || 0;
        if (this.leftSidebar) {
          this.leftSidebar.el.style.display = w > 0 && w < compactBp ? "none" : "flex";
        }
      };
      this.compactRO = new ResizeObserver(sync);
      this.compactRO.observe(this.root);
      sync();
    }
    void this.boot();
  }
  toggleFullscreen() {
    const el = this.root;
    if (!document.fullscreenElement) {
      void el.requestFullscreen?.();
    } else {
      void document.exitFullscreen?.();
    }
  }
  async boot() {
    try {
      await this.data.resolveAndLoad();
    } catch (e) {
      if (!this.destroyed) console.error("[raze-charts] failed to load symbol", e);
    }
    if (this.destroyed) return;
    if (this.toolbar && this.context.features.has("header_resolutions")) {
      this.intervalSelector = new IntervalSelector(
        this.context,
        this.toolbar.intervalSlot,
        (res) => {
          this.runDataChange(
            `change resolution to ${res}`,
            () => this.data.changeResolution(res)
          );
        },
        this.context.options.favorites?.intervals?.map(String)
      );
      this.context.intervalChanged.subscribe(null, ((res) => {
        this.intervalSelector?.setActive(String(res));
      }));
    }
    this.loading?.hide();
    this.loading = null;
    this.resolveHeaderReady();
    this.isChartReady = true;
    this.chartReady.fire();
  }
  resolveHeaderReady() {
    if (this.headerReadySettled) return;
    this.headerReadySettled = true;
    this.headerReadyResolve();
  }
  syncAccessibility() {
    this.engine.syncAccessibility();
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-label", this.engine.accessibilityLabel);
    this.root.setAttribute("aria-describedby", this.engine.accessibilityDescriptionId);
  }
  runDataChange(description, start, callback, after) {
    if (this.destroyed) return;
    const requestId = ++this.dataChangeId;
    let request;
    try {
      request = start();
    } catch (error) {
      console.error(`[raze-charts] failed to ${description}`, error);
      return;
    }
    void request.then(() => {
      if (this.destroyed || requestId !== this.dataChangeId) return;
      this.syncAccessibility();
      after?.();
      callback?.();
    }).catch((error) => {
      if (this.destroyed || requestId !== this.dataChangeId) return;
      console.error(`[raze-charts] failed to ${description}`, error);
    });
  }
  onChartReady(callback) {
    if (this.isChartReady) {
      queueMicrotask(callback);
    } else {
      this.chartReady.subscribe(null, callback, true);
    }
  }
  headerReady() {
    return this.headerReadyPromise;
  }
  activeChart() {
    return this.api;
  }
  chart(_index) {
    return this.api;
  }
  createButton(options) {
    if (!this.toolbar) {
      const btn = document.createElement("div");
      return btn;
    }
    return this.toolbar.createButton(options);
  }
  setCSSCustomProperty(name, value) {
    this.root.style.setProperty(name, value);
  }
  subscribe(event, callback) {
    let set = this.subscriptions.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.subscriptions.set(event, set);
    }
    set.add(callback);
  }
  unsubscribe(event, callback) {
    this.subscriptions.get(event)?.delete(callback);
  }
  emit(event, ...args) {
    const set = this.subscriptions.get(event);
    if (!set) return;
    for (const cb of Array.from(set)) {
      try {
        cb(...args);
      } catch {
      }
    }
  }
  onContextMenu(callback) {
    this.contextMenuCb = callback;
  }
  setSymbol(symbol, interval, callback) {
    this.runDataChange(
      `change symbol to ${symbol}`,
      () => this.data.changeSymbol(symbol, interval),
      callback,
      () => this.intervalSelector?.refresh()
    );
  }
  remove() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.dataChangeId += 1;
    this.data.destroy();
    this.resolveHeaderReady();
    closeContextMenu();
    this.compactRO?.disconnect();
    this.compactRO = null;
    this.renderer.destroy();
    this.engine.destroy();
    this.studies.destroy();
    this.intervalSelector?.destroy();
    this.indicatorsMenu?.destroy();
    this.leftSidebar?.destroy();
    this.scaleBar?.destroy();
    this.toolbar?.destroy();
    this.loading?.destroy();
    this.chartReady.destroy();
    this.subscriptions.clear();
    this.root.remove();
  }
  wireContextMenu() {
    this.chartArea.addEventListener("contextmenu", (e) => {
      if (this.renderer.lastPointerType !== "mouse") {
        e.preventDefault();
        return;
      }
      if (!this.contextMenuCb) return;
      e.preventDefault();
      const { unixTime, price } = this.renderer.timePriceAtEvent(e);
      const result = this.contextMenuCb(unixTime, price);
      const show = (items) => {
        showContextMenu(e.clientX, e.clientY, items, this.context.fontFamily);
      };
      if (result instanceof Promise) {
        void result.then(show);
      } else {
        show(result);
      }
    });
  }
};

// src/data/dataSource.ts
function errorMessage2(error) {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === "string" ? error : "Unknown data source error";
}
function invoke(operation) {
  return Promise.resolve().then(operation);
}
function safely(operation) {
  try {
    operation();
  } catch {
  }
}
function cleanupSafely(cleanup) {
  try {
    const result = cleanup();
    if (result && typeof result.then === "function") {
      void Promise.resolve(result).catch(() => {
      });
    }
  } catch {
  }
}
function normalizeHistory(result) {
  if (Array.isArray(result)) return { bars: Array.from(result), meta: { noData: result.length === 0 } };
  const history = result;
  if (!history || !Array.isArray(history.bars)) {
    throw new TypeError("RazeDataSource.getBars() must return a Bar[] or { bars, meta } result.");
  }
  return {
    bars: Array.from(history.bars),
    meta: {
      ...history.meta,
      noData: history.meta?.noData ?? history.bars.length === 0
    }
  };
}
function fallbackConfiguration(source, defaults) {
  return {
    exchanges: defaults?.exchanges ?? [],
    supported_resolutions: defaults?.supportedResolutions ?? [],
    symbols_types: defaults?.symbolTypes ?? [],
    supports_marks: Boolean(source.getMarks),
    supports_time: Boolean(source.getServerTime)
  };
}
function configurationFor(source, defaults) {
  const configured = typeof source.configuration === "function" ? source.configuration() : source.configuration;
  const fallback = fallbackConfiguration(source, defaults);
  if (!configured) return fallback;
  if (typeof configured.then === "function") {
    return Promise.resolve(configured).then((value) => ({ ...fallback, ...value }));
  }
  return { ...fallback, ...configured };
}
function createDatafeed(source, defaults) {
  const subscriptions = /* @__PURE__ */ new Map();
  const datafeed = {
    onReady(callback) {
      queueMicrotask(() => {
        invoke(() => configurationFor(source, defaults)).then(
          (configuration) => safely(() => callback(configuration)),
          () => safely(() => callback(fallbackConfiguration(source, defaults)))
        );
      });
    },
    searchSymbols(userInput, exchange, symbolType, onResult) {
      if (!source.searchSymbols) {
        queueMicrotask(() => safely(() => onResult([])));
        return;
      }
      invoke(() => source.searchSymbols({ query: userInput, exchange, symbolType })).then((items) => Array.from(items)).then(
        (items) => safely(() => onResult(items)),
        () => safely(() => onResult([]))
      );
    },
    resolveSymbol(symbolName, onResolve, onError) {
      invoke(() => source.resolveSymbol(symbolName)).then(
        (info) => safely(() => onResolve(info)),
        (error) => safely(() => onError(errorMessage2(error)))
      );
    },
    getBars(symbolInfo, resolution, periodParams, onResult, onError) {
      invoke(() => source.getBars({
        symbol: symbolInfo.ticker ?? symbolInfo.name,
        symbolInfo,
        resolution,
        from: periodParams.from,
        to: periodParams.to,
        countBack: periodParams.countBack,
        firstDataRequest: periodParams.firstDataRequest
      })).then(normalizeHistory).then(
        (history) => safely(() => onResult(Array.from(history.bars), history.meta)),
        (error) => safely(() => onError(errorMessage2(error)))
      );
    },
    subscribeBars(symbolInfo, resolution, onTick, listenerGuid, onResetCacheNeededCallback) {
      datafeed.unsubscribeBars(listenerGuid);
      const controller = new AbortController();
      const record = { controller };
      subscriptions.set(listenerGuid, record);
      if (!source.subscribeBars) return;
      invoke(() => source.subscribeBars(
        {
          symbol: symbolInfo.ticker ?? symbolInfo.name,
          symbolInfo,
          resolution,
          signal: controller.signal
        },
        {
          next: (bar) => {
            if (!controller.signal.aborted && subscriptions.get(listenerGuid) === record) safely(() => onTick(bar));
          },
          reset: () => {
            if (!controller.signal.aborted && subscriptions.get(listenerGuid) === record) {
              safely(onResetCacheNeededCallback);
            }
          }
        }
      )).then((cleanup) => {
        if (typeof cleanup !== "function") return;
        if (controller.signal.aborted || subscriptions.get(listenerGuid) !== record) {
          cleanupSafely(cleanup);
        } else {
          record.cleanup = cleanup;
        }
      }, () => {
        if (!controller.signal.aborted && subscriptions.get(listenerGuid) === record) {
          subscriptions.delete(listenerGuid);
          controller.abort();
        }
      });
    },
    unsubscribeBars(listenerGuid) {
      const record = subscriptions.get(listenerGuid);
      if (!record) return;
      subscriptions.delete(listenerGuid);
      record.controller.abort();
      if (record.cleanup) cleanupSafely(record.cleanup);
    }
  };
  if (source.getMarks) {
    datafeed.getMarks = (symbolInfo, from, to, onData, resolution) => {
      invoke(() => source.getMarks({
        symbol: symbolInfo.ticker ?? symbolInfo.name,
        symbolInfo,
        resolution,
        from,
        to
      })).then((marks) => Array.from(marks)).then(
        (marks) => safely(() => onData(marks)),
        () => safely(() => onData([]))
      );
    };
  }
  if (source.getServerTime) {
    datafeed.getServerTime = (callback) => {
      invoke(() => source.getServerTime()).then((time) => safely(() => callback(time)), () => {
      });
    };
  }
  return datafeed;
}
function defineDataSource(source) {
  return source;
}

// src/index.ts
var version = true ? "0.4.0" : "dev";
var index_default = { widget: Widget, version };
export {
  BUILTIN_STUDIES,
  ChartApi,
  ChartEngine,
  ChartRenderer,
  DEFAULT_INDICATOR_PRESETS,
  DEFAULT_INTERVAL_FAVORITES,
  DEFAULT_SIDEBAR_ITEMS,
  DataManager,
  Delegate,
  IndicatorsMenu,
  IntervalSelector,
  LEFT_SIDEBAR_W,
  LeftSidebar,
  LoadingScreen,
  ScaleBar,
  ShapeStore,
  StudyRegistry,
  StudyStore,
  TOOLBAR_HEIGHT,
  TimeIndex,
  Toolbar,
  Widget,
  applySymbolInfo,
  buildFeatureSet,
  buildTheme,
  closeContextMenu,
  closesFromBars,
  createDatafeed,
  createPriceFormatter,
  decimalsFromPricescale,
  index_default as default,
  defineDataSource,
  ema,
  ensureBaseStyles,
  floorToBar,
  formatCompact,
  formatPrice,
  formatVolume,
  heikinAshi,
  isCoarsePointer,
  isLightColor,
  openPopup,
  parseResolution,
  popupRow,
  resolutionLabel,
  resolutionToMs,
  resolveIndicatorPresets,
  rsi,
  showContextMenu,
  sma,
  version,
  Widget as widget,
  withAlpha
};
//# sourceMappingURL=charting_library.esm.js.map
