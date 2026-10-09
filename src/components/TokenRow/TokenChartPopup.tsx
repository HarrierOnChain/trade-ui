"use client";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  razeChartOptions,
  razeWidgetCtor,
  TOKEN_CHART_INTERVALS,
  type IChartingLibraryWidget,
  type ResolutionString,
} from "../../lib/razeChart";
import { SolanaDatafeed } from "../SolanaDatafeed";
import { TokenIcon } from "../atoms/TokenIcon";
import { fmtMcap, fmtNum, fmtUsd } from "../../lib/format";
import { useQuickBuy } from "../../hooks/useQuickBuy";
import { useQuickSell } from "../../hooks/useQuickSell";
import { useBuyQuoteMint } from "../../hooks/useBuyQuoteMint";
import { swapsOn } from "../../lib/chains";
import type { TokenEvent } from "../../types";
import type { LivePrice } from "../../hooks/useLiveTradePrices";

const BUY_PRESETS = [0.1, 0.5, 1, 5];
const SELL_PRESETS = [25, 50, 75, 100];

const POPUP_W = 300;
const CHART_H = 160;
const PAD_X = 12;

// ── Mini chart (candles only, no chrome) ─────────────────────────────────────

const TF_OPTIONS: { res: ResolutionString; label: string }[] = [
  { res: "1S" as ResolutionString,  label: "1s"  },
  { res: "30S" as ResolutionString, label: "30s" },
  { res: "1" as ResolutionString,   label: "1m"  },
  { res: "30" as ResolutionString,  label: "30m" },
  { res: "60" as ResolutionString,  label: "1h"  },
  { res: "240" as ResolutionString, label: "4h"  },
];

function TVChartMini({ mint, interval }: { mint: string; interval: ResolutionString }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<IChartingLibraryWidget | null>(null);
  const datafeedRef = useRef<SolanaDatafeed | null>(null);

  // Datafeed lifecycle: recreate only on mint change.
  // prefetchMint starts OHLCV + supply + solPrice concurrently so that by
  // the time the widget calls resolveSymbol → getBars, the data is ready.
  useEffect(() => {
    const datafeed = new SolanaDatafeed();
    datafeed.setMode("usd", "mcap");
    datafeed.prefetchMint(mint);
    datafeedRef.current = datafeed;
    return () => {
      datafeed.destroy();
      datafeedRef.current = null;
    };
  }, [mint]);

  // Widget lifecycle: recreate on mint or interval change.
  // On interval switch the datafeed (and its supply/solPrice caches) is
  // reused, so only the new timeframe's OHLCV request goes out.
  useEffect(() => {
    const el = containerRef.current;
    const datafeed = datafeedRef.current;
    if (!el || !datafeed) return;

    widgetRef.current?.remove();
    widgetRef.current = null;

    const ChartWidget = razeWidgetCtor();
    const tvWidget = new ChartWidget(razeChartOptions({
      symbol: mint,
      datafeed,
      interval,
      container: el,
      disabled_features: [
        "header_widget",
        "header_resolutions",
        "left_toolbar",
        "legend_widget",
        "scale_bar",
        "popup_hints",
        "display_market_status",
        "study_templates",
        "header_saveload",
        "use_localstorage_for_settings",
        "header_symbol_search",
        "symbol_search_hot_key",
        "header_compare",
        "shift_visible_range_on_new_bar",
      ],
      theme: "dark",
      favorites: { intervals: TOKEN_CHART_INTERVALS },
      overrides: {
        "scalesProperties.textColor": "#181615",
        "scalesProperties.backgroundColor": "#181615",
        "scalesProperties.lineColor": "#181615",
      },
      raze: {
        compact_breakpoint: 0,
        aria_label: `${mint} mini chart`,
      },
    }));
    widgetRef.current = tvWidget;

    return () => {
      widgetRef.current?.remove();
      widgetRef.current = null;
      // datafeed is owned by the mint-scoped effect above; don't destroy here.
    };
  }, [mint, interval]);

  // Clip any residual scale whitespace by letting the inner div overflow
  // slightly to the right/bottom while the outer clips it.
  return (
    <div
      ref={outerRef}
      style={{
        width: POPUP_W - PAD_X * 2,
        height: CHART_H,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  );
}

// ── Popup content ─────────────────────────────────────────────────────────────

interface PopupContentProps {
  token: TokenEvent;
  live?: LivePrice;
  solPrice?: number;
  holdingAmount?: number;
  holdingUsd?: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function TokenChartPopupContent({ token, live, solPrice, holdingAmount, holdingUsd, onMouseEnter, onMouseLeave }: PopupContentProps) {
  const [tf, setTf] = useState<ResolutionString>("1" as ResolutionString);
  const { run: buy, busy } = useQuickBuy(token.mint_address);
  const { run: sell, busy: sellBusy } = useQuickSell(token.mint_address);
  const [quote] = useBuyQuoteMint();
  const canTrade = swapsOn();
  const priceSol = live?.price ?? token.lastPrice ?? 0;
  const mcap = token.marketCap ?? (priceSol && solPrice ? priceSol * 1_000_000_000 * solPrice : null);
  const pct = token.priceChange ?? 0;
  const pctColor = pct > 0 ? "#66d89e" : pct < 0 ? "#e57359" : "#7a776e";

  const symbol = token.symbol?.trim() || token.name?.trim() || "";
  const name = token.name?.trim() || "";

  const hasStats = holdingAmount != null || (token.volume24h != null && token.volume24h > 0) || (token.holders != null && token.holders > 0);

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        width: POPUP_W,
        background: "#181615",
        border: "1px solid rgba(244,238,225,0.08)",
        borderRadius: 6,
        boxShadow: "0 16px 48px -8px rgba(0,0,0,0.8), 0 2px 8px -2px rgba(0,0,0,0.5)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: `6px ${PAD_X}px 6px`,
        borderBottom: "1px solid rgba(244,238,225,0.06)",
        fontFamily: "Geist, -apple-system, system-ui, sans-serif",
      }}>
        {/* Icon */}
        <div style={{ flexShrink: 0, paddingTop: 1 }}>
          <TokenIcon token={token} size={24} />
        </div>

        {/* Symbol + name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: "#f4eee1",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {symbol}
          </div>
          {name && name !== symbol && (
            <div style={{ fontSize: 10, color: "#4a4844", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {name}
            </div>
          )}
        </div>

        {/* Right column: mcap → pct → stats */}
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: mcap != null && mcap > 0 ? "#f4eee1" : "#7a776e" }}>
            {mcap != null && mcap > 0 ? fmtMcap(mcap) : "—"}
          </div>
          {pct !== 0 && (
            <div style={{ fontSize: 10, fontWeight: 600, color: pctColor }}>
              {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
            </div>
          )}
          {hasStats && (
            <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 1, fontSize: 9, alignItems: "flex-end" }}>
              {holdingAmount != null && (
                <span style={{ whiteSpace: "nowrap" }}>
                  <span style={{ color: "#4a4844" }}>Held </span>
                  <span style={{ color: "#c8c0b0" }}>
                    {fmtNum(holdingAmount)}{holdingUsd != null && holdingUsd > 0 ? ` · ${fmtUsd(holdingUsd)}` : ""}
                  </span>
                </span>
              )}
              {token.volume24h != null && token.volume24h > 0 && (
                <span style={{ whiteSpace: "nowrap" }}>
                  <span style={{ color: "#4a4844" }}>Vol </span>
                  <span style={{ color: "#c8c0b0" }}>{fmtUsd(token.volume24h)}</span>
                </span>
              )}
              {token.holders != null && token.holders > 0 && (
                <span style={{ whiteSpace: "nowrap" }}>
                  <span style={{ color: "#4a4844" }}>Hldr </span>
                  <span style={{ color: "#c8c0b0" }}>{fmtNum(token.holders)}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Chart + buy overlay */}
      <div style={{ position: "relative" }}>
        <TVChartMini mint={token.mint_address} interval={tf} />
        {canTrade && <div style={{
          position: "absolute",
          bottom: 6,
          left: PAD_X,
          right: PAD_X,
          display: "flex",
          gap: 4,
          pointerEvents: "auto",
        }}>
          {BUY_PRESETS.map((amt) => (
            <button
              key={amt}
              type="button"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); void buy(amt); }}
              style={{
                flex: 1,
                height: 18,
                borderRadius: 3,
                border: "1px solid rgba(102,216,158,0.25)",
                background: "#181615",
                color: busy ? "#3a3835" : "#66d89e",
                fontFamily: "Geist, -apple-system, system-ui, sans-serif",
                fontSize: 9,
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {amt} {quote.label}
            </button>
          ))}
        </div>}

        {/* Timeframe selector – vertical stack, right edge */}
        <div style={{
          position: "absolute",
          top: 6,
          right: 6,
          display: "flex",
          flexDirection: "column",
          gap: 3,
          pointerEvents: "auto",
        }}>
          {TF_OPTIONS.map(({ res, label }) => (
            <button
              key={res}
              type="button"
              onClick={(e) => { e.stopPropagation(); setTf(res); }}
              style={{
                width: 24,
                height: 18,
                borderRadius: 3,
                border: `1px solid ${tf === res ? "#66d89e" : "rgba(244,238,225,0.10)"}`,
                background: tf === res ? "rgba(102,216,158,0.12)" : "rgba(16,14,12,0.82)",
                color: tf === res ? "#66d89e" : "#7a776e",
                fontFamily: "Geist, -apple-system, system-ui, sans-serif",
                fontSize: 9,
                fontWeight: 600,
                cursor: "pointer",
                backdropFilter: "blur(4px)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Sell presets — only when holding */}
      {canTrade && holdingAmount != null && holdingAmount > 0 && (
        <div style={{
          display: "flex",
          gap: 4,
          padding: `5px ${PAD_X}px`,
          borderTop: "1px solid rgba(244,238,225,0.06)",
        }}>
          {SELL_PRESETS.map((pct) => (
            <button
              key={pct}
              type="button"
              disabled={sellBusy}
              onClick={(e) => { e.stopPropagation(); void sell(pct); }}
              style={{
                flex: 1,
                height: 20,
                borderRadius: 3,
                border: "1px solid rgba(229,115,89,0.25)",
                background: "#181615",
                color: sellBusy ? "#3a3835" : "#e57359",
                fontFamily: "Geist, -apple-system, system-ui, sans-serif",
                fontSize: 9,
                fontWeight: 600,
                cursor: sellBusy ? "not-allowed" : "pointer",
              }}
            >
              {pct}%
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Portal wrapper ────────────────────────────────────────────────────────────

interface Props {
  anchorRef: React.RefObject<HTMLElement | null>;
  token: TokenEvent;
  live?: LivePrice;
  solPrice?: number;
  holdingAmount?: number;
  holdingUsd?: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function TokenChartPopup({ anchorRef, token, live, solPrice, holdingAmount, holdingUsd, onMouseEnter, onMouseLeave }: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const POPUP_TOTAL_H = CHART_H + 48; // header ~44px + 1px border
    const top = Math.max(8, rect.top - POPUP_TOTAL_H - 4);
    let left = rect.left;
    if (left + POPUP_W > window.innerWidth - 8) left = window.innerWidth - POPUP_W - 8;
    if (left < 8) left = 8;
    setPos({ top, left });
  }, [anchorRef]);

  if (!pos) return null;

  return createPortal(
    <div style={{
      position: "fixed",
      top: pos.top,
      left: pos.left,
      zIndex: 9999,
      pointerEvents: "auto",
      animation: "quickBuyIn 120ms ease-out",
    }}>
      <TokenChartPopupContent
        token={token}
        live={live}
        solPrice={solPrice}
        holdingAmount={holdingAmount}
        holdingUsd={holdingUsd}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
    </div>,
    document.body
  );
}
