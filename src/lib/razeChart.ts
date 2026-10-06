import razeCharts, { widget as NamedWidget, formatCompact, formatPrice } from "@razedotbot/charts";
import type {
  ChartingLibraryWidgetOptions,
  ChartOverrides,
  EntityId,
  IChartingLibraryWidget,
  ResolutionString,
} from "@razedotbot/charts";

export { widget, formatCompact, formatPrice } from "@razedotbot/charts";
export type {
  Bar,
  ChartingLibraryWidgetOptions,
  ChartOverrides,
  DatafeedConfiguration,
  DatafeedErrorCallback,
  EntityId,
  GetMarksCallback,
  HistoryCallback,
  IBasicDataFeed,
  IChartingLibraryWidget,
  IChartWidgetApi,
  IDatafeedChartApi,
  IExternalDatafeed,
  ITradingLineAdapter,
  LibrarySymbolInfo,
  Mark,
  OnReadyCallback,
  PeriodParams,
  ResolveCallback,
  ResolutionString,
  SearchSymbolsCallback,
  SubscribeBarsCallback,
  ThemeName,
  TradingLineEvent,
  TradingLineOptions,
} from "@razedotbot/charts";

export const TOKEN_CHART_INTERVALS = [
  "1S", "5S", "15S", "30S", "1", "5", "15", "30", "60", "240", "1D",
] as ResolutionString[];

export const RAZE_CHART_OVERRIDES: ChartOverrides = {
  "paneProperties.background": "#181615",
  "paneProperties.backgroundType": "solid",
  "paneProperties.vertGridProperties.color": "rgba(244,238,225,0.04)",
  "paneProperties.horzGridProperties.color": "rgba(244,238,225,0.04)",
  "paneProperties.crossHairProperties.color": "rgba(244,238,225,0.3)",
  "scalesProperties.textColor": "#8b887e",
  "scalesProperties.backgroundColor": "#181615",
  "scalesProperties.lineColor": "#3d3935",
  "scalesProperties.showPriceScaleCrosshairLabel": true,
  "scalesProperties.showTimeScaleCrosshairLabel": true,
  "mainSeriesProperties.candleStyle.upColor": "#66d89e",
  "mainSeriesProperties.candleStyle.downColor": "#e57359",
  "mainSeriesProperties.candleStyle.borderUpColor": "#66d89e",
  "mainSeriesProperties.candleStyle.borderDownColor": "#e57359",
  "mainSeriesProperties.candleStyle.wickUpColor": "#66d89e",
  "mainSeriesProperties.candleStyle.wickDownColor": "#e57359",
};

export function formatRazeChartPrice(value: number, pricescale?: number): string {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 1000) return formatCompact(value);
  return formatPrice(value, pricescale && pricescale > 0 ? pricescale : 100);
}

export function razeWidgetCtor(): typeof NamedWidget {
  const ns = razeCharts as unknown as {
    widget?: typeof NamedWidget;
    default?: { widget?: typeof NamedWidget };
  };
  const ctor = (typeof NamedWidget === "function" ? NamedWidget : undefined)
    ?? ns.widget
    ?? ns.default?.widget;
  if (typeof ctor !== "function") {
    throw new Error("Raze charts widget export missing");
  }
  return ctor;
}

export function applyRazeChartChrome(chart: IChartingLibraryWidget): void {
  chart.setCSSCustomProperty("--tv-color-platform-background", "#181615");
  chart.setCSSCustomProperty("--tv-color-pane-background", "#181615");
  chart.setCSSCustomProperty("--tv-color-toolbar-button-background-active", "#211f1d");
  chart.setCSSCustomProperty("--tv-color-toolbar-button-background-hover", "#272522");
  chart.setCSSCustomProperty("--tv-color-toolbar-button-text", "#f4eee1");
  chart.setCSSCustomProperty("--tv-color-toolbar-button-text-hover", "#66d89e");
  chart.setCSSCustomProperty("--tv-color-toolbar-divider-background", "#3d3935");
  chart.setCSSCustomProperty("--tv-color-popup-background", "#211f1d");
  chart.setCSSCustomProperty("--tv-color-popup-element-text", "#f4eee1");
  chart.setCSSCustomProperty("--tv-color-popup-element-background-hover", "#272522");
}

export function subscribeDrawingEvent(
  chart: IChartingLibraryWidget,
  handler: (sourceId: EntityId, eventType: string) => void,
): void {
  chart.subscribe("drawing_event", ((...args: never[]) => {
    const [sourceId, eventType] = args as unknown as [EntityId, string];
    handler(sourceId, eventType);
  }) as (...args: never[]) => void);
}

export function razeChartOptions({
  enabled_features,
  disabled_features,
  overrides,
  raze,
  favorites,
  custom_formatters,
  ...rest
}: ChartingLibraryWidgetOptions): ChartingLibraryWidgetOptions {
  const features = new Set(["mark_on_bars", ...(enabled_features ?? [])]);
  return {
    locale: "en",
    autosize: true,
    timezone: "exchange",
    custom_font_family: "'JetBrains Mono', ui-monospace, monospace",
    loading_screen: { backgroundColor: "#181615", foregroundColor: "#d8aa5b" },
    ...rest,
    overrides: { ...RAZE_CHART_OVERRIDES, ...overrides },
    enabled_features: [...features],
    disabled_features,
    favorites,
    custom_formatters: {
      priceFormatterFactory: () => ({
        format: (value) => formatRazeChartPrice(value),
      }),
      ...custom_formatters,
    },
    raze: {
      compact_breakpoint: 520,
      chart_types: [
        "candles",
        "line",
        "area",
        "heikin_ashi",
        "bars",
        "hollow_candles",
        "baseline",
        "columns",
      ],
      format_price: formatRazeChartPrice,
      ...raze,
    },
  };
}
