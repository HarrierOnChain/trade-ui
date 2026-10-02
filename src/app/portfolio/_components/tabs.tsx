"use client";
/**
 * Holdings / Activity / Perps tabs — the data panels that hang off the
 * portfolio tab nav. Pure presentation: receives already-shaped data
 * from the page orchestrator and renders.
 *
 * The functional contract (which trades belong, how PnL is reconciled,
 * how demo data is shimmed) lives in page.tsx — these components just
 * project that into rows.
 */

import React, { useMemo, useState } from "react";
import type { Trade, TokenHolding } from "../../../types";
import type {
  PerpScopePosition,
  PerpScopeTrade,
} from "../../../hooks/usePortfolioPerps";
import type { TrackerAlert } from "../../../hooks/useTrackerStream";
import { liveUnrealizedPnl } from "../../../hooks/usePerpLivePrices";
import { TokenIdentity } from "../../../components/atoms";
import { useSolPrice } from "../../../hooks/useSolPrice";
import { fmtUsd, fmtMcap } from "../../../lib/format";
import { formatAge } from "../../../lib/ageRegistry";
import { tradeIdentityKey, tradeKeyAcrossTokens } from "../../../lib/trades";
import { useIsPhone } from "../../../hooks/useMediaQuery";
import { EmptyHero } from "./atoms";
import { DataTable, dataCell, dataCellRight, PillSearch, MiniToggle, EmptyRow } from "./ui";

const e6Num = (n: number) => n / 1_000_000;
function marketLabel(market_id: string): string {
  return market_id.includes(":") ? market_id.split(":")[1] : market_id;
}

function tradeMs(t: Trade | string | number | null | undefined): number {
  if (t == null) return 0;
  const raw = typeof t === "object" ? t.timestamp : t;
  if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;
  const n = Date.parse(String(raw));
  return Number.isFinite(n) ? n : 0;
}

function tradeMarketCap(t: Trade): number | undefined {
  if (t.marketCap != null && Number.isFinite(t.marketCap) && t.marketCap > 0) {
    return t.marketCap;
  }
  const avgPriceUsd =
    typeof t.avgPriceUSD === "number"
      ? t.avgPriceUSD
      : typeof t.avgPriceUSD === "string"
      ? Number(t.avgPriceUSD)
      : undefined;
  return avgPriceUsd != null && Number.isFinite(avgPriceUsd) && avgPriceUsd > 0
    ? avgPriceUsd * 1_000_000_000
    : undefined;
}

function alertToTrade(a: TrackerAlert): Trade {
  return {
    signature: a.signature,
    tokenMint: a.tokenMint,
    signer: a.signer,
    transactionType: a.side,
    tokensAmount: a.tokensAmount,
    avgPrice: 0,
    solAmount: a.solAmount,
    timestamp: a.timestamp,
    usdValue: a.usdValue,
    marketCap: a.marketCap,
  };
}

function formatAmount(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n < 0.0001) return n.toExponential(2);
  if (n < 1) return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (n < 1_000) return n.toFixed(2);
  if (n < 1_000_000) return (n / 1_000).toFixed(2) + "K";
  if (n < 1_000_000_000) return (n / 1_000_000).toFixed(2) + "M";
  return (n / 1_000_000_000).toFixed(2) + "B";
}

/* ── Shared table chrome — Caesar muted-header tables (DataTable in ./ui) ─ */

function dataRowStyle(highlight?: boolean): React.CSSProperties {
  return {
    background: highlight ? "color-mix(in oklch, var(--accent) 7%, transparent)" : "transparent",
    transition: "background 100ms",
    cursor: "pointer",
  };
}

const cellStyle = dataCell;
const cellRight = dataCellRight;

/* ── Holdings tab ────────────────────────────────────────────────────── */

export function HoldingsTab({
  holdings, liveMap, loading,
  onTokenClick,
}: {
  holdings: TokenHolding[];
  liveMap: Map<string, import("../../../hooks/useLiveTradePrices").LivePrice>;
  loading: boolean;
  onTokenClick: (mint: string) => void;
}) {
  const solPrice = useSolPrice() ?? 0;
  const isPhone = useIsPhone();
  const [search, setSearch] = useState("");
  const [ccy, setCcy] = useState<"USD" | "SOL">("USD");

  const rows = useMemo(() => {
    return holdings.map((h) => {
      const lp = liveMap.get(h.mint)?.price ?? 0;
      const liveUsd = lp > 0 && solPrice > 0 ? lp * solPrice * h.amount : 0;
      // The API's valuation (0 included) wins; live price only when it is null.
      const usd = h.usdValue != null ? h.usdValue : liveUsd;
      return { holding: h, usd };
    }).sort((a, b) => b.usd - a.usd);
  }, [holdings, liveMap, solPrice]);

  const totalUsd = rows.reduce((s, r) => s + r.usd, 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(({ holding: h }) =>
      (h.symbol ?? "").toLowerCase().includes(q) ||
      (h.name ?? "").toLowerCase().includes(q) ||
      h.mint.toLowerCase().includes(q));
  }, [rows, search]);

  const valueText = (usd: number) =>
    ccy === "SOL"
      ? (solPrice > 0
        ? `${(usd / solPrice).toFixed(4)} ◎`
        : usd === 0 ? "0.0000 ◎" : "—")
      : fmtUsd(usd);

  if (loading && rows.length === 0) {
    return <TableSkeleton columns={3} rows={6} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyHero
        title="No spot holdings."
        body="Buy a token from the trading panel or fire a sniper. Once a bag opens, it shows up here with live USD value, share-of-portfolio bar, and one-click access to the token page."
      />
    );
  }
  return (
    <div style={{
      background: "var(--ink-1)", border: "1px solid var(--line-soft)",
      borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-sm)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        padding: "10px 14px", borderBottom: "1px solid var(--line-soft)", background: "var(--ink-2)",
      }}>
        <PillSearch value={search} onChange={setSearch} placeholder="Search by name or address" width={240} />
        <div style={{ flex: 1 }} />
        <MiniToggle<"USD" | "SOL">
          value={ccy}
          onChange={setCcy}
          options={[{ value: "USD", label: "USD" }, { value: "SOL", label: "SOL" }]}
        />
      </div>
      <DataTable headers={[
        { key: "token",  label: "Token" },
        { key: "amount", label: "Amount", align: "right" },
        { key: "value",  label: "Value", align: "right" },
      ]}>
        {filtered.length === 0 ? (
          <EmptyRow colSpan={3} title="No tokens match" body={search ? `Nothing matches “${search}”.` : undefined} />
        ) : filtered.map(({ holding: h, usd }) => {
          const pct = totalUsd > 0 ? (usd / totalUsd) * 100 : 0;
          return (
            <tr
              key={h.mint}
              style={dataRowStyle()}
              onClick={() => onTokenClick(h.mint)}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ink-2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <td data-label="Token" style={cellStyle}>
                <TokenIdentity
                  mint={h.mint}
                  symbol={h.symbol}
                  name={h.name}
                  image={h.image}
                  showImage
                  compact
                  size="xs"
                  onOpen={onTokenClick}
                  chartToken={{ mint_address: h.mint, name: h.name ?? "", symbol: h.symbol ?? "", dex: "", created_at: "" }}
                  chartSolPrice={solPrice}
                />
              </td>
              <td data-label="Amount" style={cellRight}>{formatAmount(h.amount)}</td>
              <td data-label="Value" style={cellRight}>
                <div style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4,
                }}>
                  <span style={{ fontWeight: 500 }}>{valueText(usd)}</span>
                  {pct > 0 && (
                    <div style={{
                      position: "relative",
                      width: isPhone ? 80 : 120, height: 12, borderRadius: 999,
                      background: "var(--ink-0)", border: "1px solid var(--line-soft)",
                      overflow: "hidden",
                    }}>
                      <span style={{
                        position: "absolute", left: 0, top: 0, bottom: 0,
                        width: `${Math.min(pct, 100)}%`,
                        background: "var(--accent)",
                        opacity: 0.7,
                      }} />
                      <span style={{
                        position: "absolute", inset: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, color: "var(--paper)", fontWeight: 600,
                        fontFamily: "var(--font-mono)",
                      }}>{pct.toFixed(1)}%</span>
                    </div>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </DataTable>
    </div>
  );
}

/* ── Perps tab ───────────────────────────────────────────────────────── */

export function PerpsTab({
  positions, livePrices, loading, onMarketClick,
}: {
  positions: PerpScopePosition[];
  livePrices: Record<string, number>;
  loading: boolean;
  onMarketClick?: (marketId: string) => void;
}) {
  if (loading && positions.length === 0) {
    return <TableSkeleton columns={5} rows={4} />;
  }
  if (positions.length === 0) {
    return (
      <EmptyHero
        title="No open perp positions."
        body="Open a long or short on the perpetuals page. Open positions show up here with live uPnL based on the latest oracle close."
      />
    );
  }
  return (
    <div style={{
      background: "var(--ink-1)", border: "1px solid var(--line-soft)",
      borderRadius: 12, overflow: "hidden",
    }}>
      <DataTable headers={[
        { key: "market", label: "Market" },
        { key: "side",   label: "Side" },
        { key: "size",   label: "Size",  align: "right" },
        { key: "entry",  label: "Entry", align: "right" },
        { key: "uPnL",   label: "uPnL",  align: "right" },
      ]}>
        {positions.map((p) => {
          const isLong = p.side === "long";
          const sizeUsd = e6Num(p.size);
          const entryUsd = e6Num(p.entry_price);
          const live = livePrices[p.market_id];
          const upnl = liveUnrealizedPnl(p.side, sizeUsd, entryUsd, live, e6Num(p.unrealized_pnl));
          const profitable = upnl >= 0;
          return (
            <tr
              key={p.position_pubkey}
              style={dataRowStyle()}
              onClick={() => onMarketClick?.(p.market_id)}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ink-2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <td data-label="Market" style={cellStyle}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{marketLabel(p.market_id)}</span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    {p.venue}
                  </span>
                </div>
              </td>
              <td data-label="Side" style={cellStyle}>
                <SidePill side={isLong ? "long" : "short"} />
              </td>
              <td data-label="Size" style={cellRight}>{fmtUsd(sizeUsd)}</td>
              <td data-label="Entry" style={cellRight}>{fmtUsd(entryUsd)}</td>
              <td data-label="uPnL" style={{ ...cellRight, color: profitable ? "var(--buy)" : "var(--sell)", fontWeight: 600 }}>
                {upnl >= 0 ? "+" : "−"}{fmtUsd(Math.abs(upnl))}
              </td>
            </tr>
          );
        })}
      </DataTable>
    </div>
  );
}

/* ── Activity tab ────────────────────────────────────────────────────── */

interface SpotActivityRow {
  trade: Trade;
  isLive: boolean;
  isNew: boolean;
  ms: number;
}

export function ActivityTab({
  trades, liveAlerts = [], perpTrades = [], solPrice = 0, loading,
  onTokenClick, onMarketClick,
}: {
  trades: Trade[];
  liveAlerts?: TrackerAlert[];
  perpTrades?: PerpScopeTrade[];
  solPrice?: number;
  loading: boolean;
  onTokenClick: (mint: string) => void;
  onMarketClick?: (marketId: string) => void;
}) {
  const spotRows = useMemo<SpotActivityRow[]>(() => {
    // One row per (signature, wallet, token): two scoped wallets co-signing a
    // transaction are two fills.
    const seen = new Set<string>();
    const out: SpotActivityRow[] = [];
    for (const a of liveAlerts) {
      const trade = alertToTrade(a);
      if (trade.signature) seen.add(tradeKeyAcrossTokens(trade));
      out.push({
        trade, isLive: true, isNew: Boolean(a.isNew),
        ms: a.timestamp || tradeMs(trade),
      });
    }
    for (const t of trades) {
      if (t.signature && seen.has(tradeKeyAcrossTokens(t))) continue;
      out.push({ trade: t, isLive: false, isNew: false, ms: tradeMs(t) });
    }
    out.sort((x, y) => y.ms - x.ms);
    return out.slice(0, 80);
  }, [trades, liveAlerts]);

  const perpRows = useMemo(
    () => [...perpTrades].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)).slice(0, 80),
    [perpTrades],
  );

  if (loading && spotRows.length === 0 && perpRows.length === 0) {
    return <TableSkeleton columns={6} rows={8} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Spot activity */}
      <div style={{
        background: "var(--ink-1)", border: "1px solid var(--line-soft)",
        borderRadius: 12, overflow: "hidden",
      }}>
        <div style={{
          padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: "1px solid var(--line-soft)",
        }}>
          <span className="eyebrow" style={{ fontSize: 10, color: "var(--paper-3)" }}>
            Spot fills ({spotRows.length})
          </span>
        </div>
        {spotRows.length === 0 ? (
          <div style={{
            padding: "32px 16px", textAlign: "center",
            fontSize: 12, color: "var(--paper-4)",
          }}>No spot trades in the selected window.</div>
        ) : (
          <DataTable headers={[
            { key: "age",    label: "Age" },
            { key: "side",   label: "Side" },
            { key: "token",  label: "Token" },
            { key: "tokens", label: "Tokens", align: "right" },
            { key: "mc",     label: "MC", align: "right" },
            { key: "value",  label: "Value", align: "right" },
          ]}>
            {spotRows.map((row) => {
              const t = row.trade;
              const isBuy = t.transactionType === "buy";
              const usdValue =
                typeof t.usdValue === "number" && t.usdValue > 0
                  ? t.usdValue
                  : solPrice > 0 && t.solAmount != null
                  ? t.solAmount * solPrice
                  : null;
              return (
                <tr
                  key={tradeIdentityKey(t)}
                  style={dataRowStyle(row.isNew)}
                  onClick={() => onTokenClick(t.tokenMint)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ink-2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = row.isNew ? "color-mix(in oklch, var(--accent) 6%, transparent)" : "transparent"; }}
                >
                  <td data-label="Age" style={{ ...cellStyle, fontFamily: "var(--font-mono)", color: "var(--paper-3)", fontSize: 11 }}>
                    {row.ms ? formatAge(row.ms) : "—"}
                  </td>
                  <td data-label="Side" style={cellStyle}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <SidePill side={isBuy ? "buy" : "sell"} />
                      {row.isLive && (
                        <span style={{
                          fontSize: 8, padding: "1px 5px", borderRadius: 3,
                          background: "var(--accent-w)", color: "var(--accent)",
                          letterSpacing: "0.08em", textTransform: "uppercase",
                          fontFamily: "var(--font-mono)", fontWeight: 600,
                          border: "1px solid color-mix(in oklch, var(--accent) 40%, transparent)",
                        }}>Live</span>
                      )}
                    </span>
                  </td>
                  <td data-label="Token" style={cellStyle}>
                    <TokenIdentity
                      mint={t.tokenMint}
                      showImage
                      compact
                      size="xs"
                      onOpen={onTokenClick}
                      chartToken={{ mint_address: t.tokenMint, name: "", symbol: "", dex: "", created_at: "" }}
                      chartSolPrice={solPrice}
                    />
                  </td>
                  <td data-label="Tokens" style={cellRight}>{formatAmount(t.tokensAmount)}</td>
                  <td data-label="MC" style={cellRight}>{fmtMcap(tradeMarketCap(t))}</td>
                  <td data-label="Value" style={cellRight}>{usdValue != null ? fmtUsd(usdValue) : "—"}</td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </div>

      {/* Perp activity */}
      {perpRows.length > 0 && (
        <div style={{
          background: "var(--ink-1)", border: "1px solid var(--line-soft)",
          borderRadius: 12, overflow: "hidden",
        }}>
          <div style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--line-soft)",
          }}>
            <span className="eyebrow" style={{ fontSize: 10, color: "var(--paper-3)" }}>
              Perp fills ({perpRows.length})
            </span>
          </div>
          <DataTable headers={[
            { key: "age",    label: "Age" },
            { key: "side",   label: "Side" },
            { key: "market", label: "Market" },
            { key: "size",   label: "Size",  align: "right" },
            { key: "price",  label: "Price", align: "right" },
            { key: "fee",    label: "Fee",   align: "right" },
          ]}>
            {perpRows.map((p) => {
              const isLong = p.side === "long";
              return (
                <tr
                  key={`perp:${p.signature ?? `${p.position_pubkey}:${p.timestamp}`}`}
                  style={dataRowStyle()}
                  onClick={() => onMarketClick?.(p.market_id)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ink-2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <td data-label="Age" style={{ ...cellStyle, fontFamily: "var(--font-mono)", color: "var(--paper-3)", fontSize: 11 }}>
                    {p.timestamp ? formatAge(p.timestamp) : "—"}
                  </td>
                  <td data-label="Side" style={cellStyle}><SidePill side={isLong ? "long" : "short"} /></td>
                  <td data-label="Market" style={cellStyle}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{marketLabel(p.market_id)}</span>
                      <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                        {p.venue}
                      </span>
                    </div>
                  </td>
                  <td data-label="Size" style={cellRight}>{fmtUsd(e6Num(p.size))}</td>
                  <td data-label="Price" style={cellRight}>{fmtUsd(e6Num(p.price))}</td>
                  <td data-label="Fee" style={cellRight}>{fmtUsd(e6Num(p.fee))}</td>
                </tr>
              );
            })}
          </DataTable>
        </div>
      )}
    </div>
  );
}

/* ── Side pill ───────────────────────────────────────────────────────── */

function SidePill({ side }: { side: "buy" | "sell" | "long" | "short" }) {
  const isPos = side === "buy" || side === "long";
  const label = side[0].toUpperCase() + side.slice(1);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 4,
      background: isPos ? "var(--buy-w)" : "var(--sell-w)",
      color: isPos ? "var(--buy)" : "var(--sell)",
      fontSize: 10, fontWeight: 600,
      letterSpacing: "0.04em", textTransform: "uppercase",
      fontFamily: "var(--font-mono)",
      border: `1px solid color-mix(in oklch, ${isPos ? "var(--buy)" : "var(--sell)"} 38%, transparent)`,
      lineHeight: 1.4,
    }}>{label}</span>
  );
}

/* ── Skeleton ────────────────────────────────────────────────────────── */

function TableSkeleton({ columns, rows }: { columns: number; rows: number }) {
  return (
    <div style={{
      background: "var(--ink-1)", border: "1px solid var(--line-soft)",
      borderRadius: 12, padding: 12,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{
          display: "grid", gap: 12,
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        }}>
          {Array.from({ length: columns }).map((_, c) => (
            <span key={c} className="skeleton" style={{
              height: 14, borderRadius: 4,
              width: c === 0 ? "60%" : c === 1 ? "40%" : "70%",
            }} />
          ))}
        </div>
      ))}
    </div>
  );
}
