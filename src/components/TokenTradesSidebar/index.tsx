"use client";
import React, { useEffect, useRef } from "react";
import type { Trade } from "../../types";
import { formatAge, registerAge, unregisterAge } from "../../lib/ageRegistry";
import { ChainIcon } from "../atoms";
import { getActiveChain, nativeSymbol } from "../../lib/chains";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { tradeLegKey, tradeNative } from "../../lib/trades";

/// Compact live trade tape pinned to the right of the chart on the token page:
/// fixed width, only as tall as the chart, trades only (spot tokens have no
/// resting orderbook). Fed by the `trades` the page already streams via
/// `useTrades(mint)` — no extra REST fetch or WS subscription.
export const TOKEN_TRADES_SIDEBAR_WIDTH = 240;

// Normalize the polymorphic Trade.timestamp (ISO string from REST, unix ms or
// seconds from WS) to epoch-ms. Same heuristic the TradesTable / useTrades use.
function toMs(raw: string | number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!isNaN(n) && n > 0) return n > 1e15 ? n / 1000 : n > 1e12 ? n : n * 1000;
  return new Date(raw as string).getTime();
}

// Live-ticking age cell driven by the shared 1Hz ageRegistry interval (no
// per-row React re-render). Preview trades (deploy form plan) are frozen —
// static clock time, never registered with the ticking interval.
function AgeCell({ tsMs, frozen }: { tsMs: number; frozen?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (frozen) {
      unregisterAge(el);
      el.textContent = formatClock(tsMs);
      return;
    }
    el.textContent = formatAge(tsMs);
    registerAge(el, tsMs);
    return () => unregisterAge(el);
  }, [tsMs, frozen]);
  return <span ref={ref}>{frozen ? formatClock(tsMs) : formatAge(tsMs)}</span>;
}

function formatClock(tsMs: number): string {
  const d = new Date(tsMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtUsdCompact(n: number): string {
  if (!isFinite(n) || n <= 0) return "–";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 1)   return `$${n.toFixed(2)}`;
  return `$${n.toFixed(2)}`;
}

function priceUsd(t: Trade, solPrice: number): number {
  if (t.avgPriceUSD != null) {
    const p = typeof t.avgPriceUSD === "number" ? t.avgPriceUSD : Number(t.avgPriceUSD);
    if (isFinite(p) && p > 0) return p;
  }
  return (Number(t.avgPrice) || 0) * solPrice;
}

// Unknown volume is "–", never "0".
function fmtAmountLabel(t: Trade, currency: "usd" | "sol", solPrice: number): string {
  const sol = tradeNative(t);
  if (currency === "usd" && solPrice > 0) {
    if (sol != null) return fmtUsdCompact(sol * solPrice);
    return typeof t.usdValue === "number" ? fmtUsdCompact(t.usdValue) : "–";
  }
  return sol != null ? sol.toFixed(sol >= 100 ? 1 : sol >= 1 ? 2 : 3) : "–";
}

export function TokenTradesSidebar({
  trades,
  solPrice,
  supply,
  loading = false,
  currency = "usd",
  onCurrencyChange,
}: {
  trades: Trade[];
  solPrice: number;
  supply: number;
  loading?: boolean;
  currency?: "usd" | "sol";
  onCurrencyChange?: (c: "usd" | "sol") => void;
}) {
  const toggleCurrency = () => onCurrencyChange?.(currency === "sol" ? "usd" : "sol");
  const isMobile = useIsMobile();

  return (
    <div style={{
      width: isMobile ? "100%" : TOKEN_TRADES_SIDEBAR_WIDTH,
      flexShrink: 0,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      background: "var(--ink-1)",
    }}>
      {loading && trades.length === 0 ? (
        <TapeMessage>Loading trades…</TapeMessage>
      ) : trades.length === 0 ? (
        <TapeMessage>No trades yet</TapeMessage>
      ) : (
        <div style={{ overflowY: "auto", height: "100%", fontFamily: "var(--font-mono)", fontSize: 11 }}>
          <div style={{
            position: "sticky", top: 0, zIndex: 1,
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            padding: "4px 10px",
            background: "var(--ink-2)",
            borderBottom: "1px solid var(--line-soft)",
            color: "var(--paper-3)", fontSize: 9,
            textTransform: "uppercase", letterSpacing: 1,
          }}>
            <span>Time</span>
            <span style={{ textAlign: "right" }}>MCap</span>
            <span
              role="button"
              tabIndex={0}
              title={`Switch to ${currency === "sol" ? "USD" : nativeSymbol(getActiveChain())}`}
              onClick={toggleCurrency}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleCurrency();
                }
              }}
              style={{
                textAlign: "right",
                cursor: onCurrencyChange ? "pointer" : "default",
                color: onCurrencyChange ? "var(--paper-2)" : "var(--paper-3)",
                userSelect: "none",
              }}
            >
              {currency === "sol" ? nativeSymbol(getActiveChain()) : "USD"}
            </span>
          </div>
          {trades.map((t) => {
            const isBuy = t.transactionType === "buy";
            const mcap = priceUsd(t, solPrice) * supply;
            return (
              <div key={tradeLegKey(t)} style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                padding: "3px 10px",
                borderBottom: "1px solid color-mix(in oklch, var(--line-soft) 30%, transparent)",
                color: "var(--paper-2)",
                lineHeight: 1.4,
              }}>
                <span style={{ color: "var(--paper-3)" }}><AgeCell tsMs={toMs(t.timestamp)} frozen={!!t.signature?.startsWith("preview-")} /></span>
                <span style={{
                  textAlign: "right",
                  color: isBuy ? "var(--buy)" : "var(--sell)",
                  fontWeight: 600,
                }}>{fmtUsdCompact(mcap)}</span>
                <span style={{
                  textAlign: "right",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 3,
                }}>
                  {currency === "sol" && tradeNative(t) != null && (
                    <span style={{ display: "inline-flex", color: "var(--paper-4)", lineHeight: 0 }}>
                      <ChainIcon id={getActiveChain()} size={9} />
                    </span>
                  )}
                  {fmtAmountLabel(t, currency, solPrice)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TapeMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16, textAlign: "center",
      fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--paper-4)",
    }}>
      {children}
    </div>
  );
}
