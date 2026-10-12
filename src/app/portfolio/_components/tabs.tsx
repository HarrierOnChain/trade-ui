"use client";
/**
 * Holdings / Activity tabs — the data panels that hang off the
 * portfolio tab nav. Pure presentation: receives already-shaped data
 * from the page orchestrator and renders.
 *
 * The functional contract (which trades belong, how PnL is reconciled)
 * lives in page.tsx — these components just project that into rows.
 * With more than one wallet in view, each row also says which wallets it
 * belongs to.
 */

import React, { useEffect, useMemo, useState } from "react";
import type { Trade, TokenHolding } from "../../../types";
import type { WalletTradeAlert } from "../../../hooks/useWalletTradeStream";
import type { WalletTradeRow } from "../../../api/client";
import { TokenIdentity } from "../../../components/atoms";
import { useSolPrice } from "../../../hooks/useSolPrice";
import { useIsPhone } from "../../../hooks/useMediaQuery";
import { fmtUsd } from "../../../lib/format";
import { formatAge } from "../../../lib/ageRegistry";
import { tradeIdentityKey, tradeKeyAcrossTokens } from "../../../lib/trades";
import { walletAvatarColor } from "../../../lib/walletAvatar";
import { Tooltip } from "../../../components/atoms";
import { DataTable, dataCell, dataCellRight, PillSearch, MiniToggle, EmptyRow } from "./ui";
import { fmtNative } from "./money";

/** A wallet as a table shows it. */
export interface WalletTag {
  label: string;
  avatarIndex: number;
}

function tradeMs(t: Trade | string | number | null | undefined): number {
  if (t == null) return 0;
  const raw = typeof t === "object" ? t.timestamp : t;
  if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;
  const n = Date.parse(String(raw));
  return Number.isFinite(n) ? n : 0;
}

function alertToTrade(a: WalletTradeAlert): WalletTradeRow {
  return {
    signature: a.signature,
    tokenMint: a.tokenMint,
    tokenSymbol: a.tokenSymbol,
    tokenImage: a.tokenImage,
    signer: a.signer,
    transactionType: a.side,
    tokensAmount: a.tokensAmount,
    avgPrice: 0,
    solAmount: a.solAmount,
    timestamp: a.timestamp,
    usdValue: a.usdValue,
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

/** Rows drawn at first: wallets carry hundreds of dust tokens, and drawing
 *  every one froze the page (13k nodes, under 2 fps). The rest on request. */
const HOLDINGS_PAGE = 50;

/* ── Holdings tab ────────────────────────────────────────────────────── */

export function HoldingsTab({
  holdings, liveMap, loading, native, holders,
  onTokenClick,
}: {
  holdings: TokenHolding[];
  liveMap: Map<string, import("../../../hooks/useLiveTradePrices").LivePrice>;
  loading: boolean;
  /** SOL / ETH / BNB: the second currency of the value column. */
  native: string;
  /** mint → the wallets in view that hold it; a column only when set. */
  holders?: Map<string, WalletTag[]>;
  onTokenClick: (mint: string) => void;
}) {
  const solPrice = useSolPrice() ?? 0;
  // A phone gets two columns: the token, and its value with the amount under it.
  const phone = useIsPhone();
  const [search, setSearch] = useState("");
  const [ccy, setCcy] = useState<"USD" | "SOL">("USD");
  const [limit, setLimit] = useState(HOLDINGS_PAGE);
  useEffect(() => { setLimit(HOLDINGS_PAGE); }, [search]);

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
        ? `${fmtNative(usd / solPrice)} ${native}`
        : usd === 0 ? `0 ${native}` : "—")
      : fmtUsd(usd);
  const showWallets = !!holders && !phone;
  const columns = phone ? 2 : showWallets ? 4 : 3;

  if (loading && rows.length === 0) {
    return <TableSkeleton columns={3} rows={6} />;
  }
  if (rows.length === 0) {
    return <Empty>No tokens yet. Buy one from a token page or Swap, and it shows here.</Empty>;
  }
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingBottom: 12 }}>
        <PillSearch value={search} onChange={setSearch} placeholder="Search by name or address" width={240} />
        <div style={{ flex: 1 }} />
        <MiniToggle<"USD" | "SOL">
          value={ccy}
          onChange={setCcy}
          options={[{ value: "USD", label: "USD" }, { value: "SOL", label: native }]}
        />
      </div>
      <DataTable cards={false} headers={[
        { key: "token",  label: "Token" },
        ...(showWallets ? [{ key: "wallets", label: "Wallets" }] : []),
        ...(phone ? [] : [{ key: "amount", label: "Amount", align: "right" as const }]),
        { key: "value",  label: "Value", align: "right" as const },
      ]}>
        {filtered.length === 0 ? (
          <EmptyRow colSpan={columns} title="No tokens match" body={search ? `Nothing matches “${search}”.` : undefined} />
        ) : filtered.slice(0, limit).map(({ holding: h, usd }) => {
          const pct = totalUsd > 0 ? (usd / totalUsd) * 100 : 0;
          return (
            <tr
              key={h.mint}
              style={dataRowStyle()}
              onClick={() => onTokenClick(h.mint)}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ink-1)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <td data-label="Token" style={cellStyle}>
                <TokenIdentity
                  mint={h.mint}
                  symbol={h.symbol}
                  name={h.name}
                  image={h.image}
                  showImage
                  showCopy={false}
                  compact
                  size="xs"
                  onOpen={onTokenClick}
                  chartToken={{ mint_address: h.mint, name: h.name ?? "", symbol: h.symbol ?? "", dex: "", created_at: "" }}
                  chartSolPrice={solPrice}
                />
              </td>
              {showWallets && (
                <td data-label="Wallets" style={cellStyle}>
                  <AvatarStack wallets={holders!.get(h.mint) ?? []} />
                </td>
              )}
              {!phone && <td data-label="Amount" style={cellRight}>{formatAmount(h.amount)}</td>}
              <td data-label="Value" style={cellRight}>
                {valueText(usd)}
                {phone ? (
                  <div style={{ fontSize: 10.5, color: "var(--paper-4)", marginTop: 2 }}>{formatAmount(h.amount)}</div>
                ) : (
                  <span style={{ display: "inline-block", minWidth: 44, color: "var(--paper-4)", fontSize: 11 }}>
                    {pct >= 0.1 ? `${pct.toFixed(1)}%` : ""}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
        {filtered.length > limit && (
          <tr>
            <td data-label="" colSpan={columns} style={{ padding: 10, textAlign: "center", borderBottom: "1px solid var(--line-soft)" }}>
              <button type="button" onClick={() => setLimit((n) => n + HOLDINGS_PAGE * 4)} style={{
                padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                background: "transparent", border: 0,
                color: "var(--paper-3)", fontSize: 12, fontWeight: 500,
              }}>
                Show {Math.min(filtered.length - limit, HOLDINGS_PAGE * 4)} more
                <span style={{ color: "var(--paper-4)" }}> · {filtered.length - limit} left</span>
              </button>
            </td>
          </tr>
        )}
      </DataTable>
    </div>
  );
}

/* ── Activity tab ────────────────────────────────────────────────────── */

interface SpotActivityRow {
  trade: WalletTradeRow;
  isNew: boolean;
  ms: number;
}

export function ActivityTab({
  trades, liveAlerts = [], solPrice = 0, loading, walletOf,
  onTokenClick,
}: {
  trades: Trade[];
  liveAlerts?: WalletTradeAlert[];
  solPrice?: number;
  loading: boolean;
  /** The wallet a fill belongs to; a column only when set. */
  walletOf?: (signer: string) => WalletTag | undefined;
  onTokenClick: (mint: string) => void;
}) {
  const phone = useIsPhone();
  const spotRows = useMemo<SpotActivityRow[]>(() => {
    // One row per (signature, wallet, token): two scoped wallets co-signing a
    // transaction are two fills.
    const seen = new Set<string>();
    const out: SpotActivityRow[] = [];
    for (const a of liveAlerts) {
      const trade = alertToTrade(a);
      if (trade.signature) seen.add(tradeKeyAcrossTokens(trade));
      out.push({
        trade, isNew: Boolean(a.isNew),
        ms: a.timestamp || tradeMs(trade),
      });
    }
    for (const t of trades) {
      if (t.signature && seen.has(tradeKeyAcrossTokens(t))) continue;
      out.push({ trade: t as WalletTradeRow, isNew: false, ms: tradeMs(t) });
    }
    out.sort((x, y) => y.ms - x.ms);
    return out.slice(0, 80);
  }, [trades, liveAlerts]);

  if (loading && spotRows.length === 0) {
    return <TableSkeleton columns={phone ? 2 : walletOf ? 6 : 5} rows={8} />;
  }
  if (spotRows.length === 0) {
    return <Empty>No trades yet for the wallets in view.</Empty>;
  }

  return (
    <DataTable cards={false} headers={phone ? [
      { key: "token",  label: "Trade" },
      { key: "value",  label: "Value", align: "right" as const },
    ] : [
      { key: "age",    label: "Age" },
      ...(walletOf ? [{ key: "wallet", label: "Wallet" }] : []),
      { key: "side",   label: "Side" },
      { key: "token",  label: "Token" },
      { key: "tokens", label: "Tokens", align: "right" as const },
      { key: "value",  label: "Value", align: "right" as const },
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
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ink-1)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = row.isNew ? "color-mix(in oklch, var(--accent) 6%, transparent)" : "transparent"; }}
          >
            {!phone && (
              <td data-label="Age" style={{ ...cellStyle, fontFamily: "var(--font-mono)", color: "var(--paper-4)", fontSize: 11 }}>
                {row.ms ? formatAge(row.ms) : "—"}
              </td>
            )}
            {walletOf && !phone && (
              <td data-label="Wallet" style={cellStyle}>
                <WalletChip wallet={walletOf(t.signer)} />
              </td>
            )}
            {!phone && (
              <td data-label="Side" style={{ ...cellStyle, color: isBuy ? "var(--buy)" : "var(--sell)", fontWeight: 500 }}>
                {isBuy ? "Buy" : "Sell"}
              </td>
            )}
            <td data-label="Token" style={phone ? { ...cellStyle, display: "flex", alignItems: "center", gap: 8 } : cellStyle}>
              {phone && (
                <span style={{ color: isBuy ? "var(--buy)" : "var(--sell)", fontWeight: 500, width: 30, flexShrink: 0 }}>{isBuy ? "Buy" : "Sell"}</span>
              )}
              <TokenIdentity
                mint={t.tokenMint}
                symbol={t.tokenSymbol ?? undefined}
                image={t.tokenImage ?? undefined}
                showImage
                showCopy={false}
                showHide={false}
                compact
                size="xs"
                onOpen={onTokenClick}
                chartToken={{ mint_address: t.tokenMint, name: "", symbol: t.tokenSymbol ?? "", dex: "", created_at: "" }}
                chartSolPrice={solPrice}
              />
            </td>
            {!phone && <td data-label="Tokens" style={cellRight}>{formatAmount(t.tokensAmount)}</td>}
            <td data-label="Value" style={cellRight}>
              {usdValue != null ? fmtUsd(usdValue) : "—"}
              {phone && row.ms > 0 && (
                <div style={{ fontSize: 10.5, color: "var(--paper-4)", marginTop: 2 }}>{formatAge(row.ms)}</div>
              )}
            </td>
          </tr>
        );
      })}
    </DataTable>
  );
}

/* ── Wallet marks ────────────────────────────────────────────────────── */

function AvatarStack({ wallets }: { wallets: WalletTag[] }) {
  if (wallets.length === 0) return <span style={{ color: "var(--paper-4)" }}>—</span>;
  const shown = wallets.slice(0, 3);
  return (
    <Tooltip content={wallets.map((w) => w.label).join(", ")}>
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        {shown.map((w, i) => (
          <span key={`${w.label}-${i}`} style={{ marginLeft: i === 0 ? 0 : -5, display: "inline-flex", borderRadius: "50%", boxShadow: "0 0 0 2px var(--ink-0)" }}>
            <MiniAvatar wallet={w} />
          </span>
        ))}
        {wallets.length > shown.length && (
          <span className="mono" style={{ marginLeft: 5, fontSize: 10.5, color: "var(--paper-3)" }}>+{wallets.length - shown.length}</span>
        )}
      </span>
    </Tooltip>
  );
}

/** One letter in the wallet's colour: the full avatar's two letters do not
 *  read at table size. Opaque, so a stack of them overlaps cleanly. */
function MiniAvatar({ wallet }: { wallet: WalletTag }) {
  const color = walletAvatarColor(wallet.avatarIndex);
  const initial = (wallet.label.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
  return (
    <span aria-hidden style={{
      width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: `color-mix(in srgb, ${color} 20%, var(--ink-1))`,
      border: `1px solid color-mix(in srgb, ${color} 55%, transparent)`,
      color, fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", lineHeight: 1,
    }}>{initial}</span>
  );
}

function WalletChip({ wallet }: { wallet: WalletTag | undefined }) {
  if (!wallet) return <span style={{ color: "var(--paper-4)" }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, maxWidth: 150 }}>
      <MiniAvatar wallet={wallet} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--paper-2)" }}>{wallet.label}</span>
    </span>
  );
}

/* ── Empty and loading ───────────────────────────────────────────────── */

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "40px 12px", fontSize: 12.5, color: "var(--paper-4)" }}>{children}</div>;
}

function TableSkeleton({ columns, rows }: { columns: number; rows: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "14px 12px" }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{
          display: "grid", gap: 12,
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        }}>
          {Array.from({ length: columns }).map((_, c) => (
            <span key={c} className="skeleton" style={{
              height: 12, borderRadius: 4,
              width: c === 0 ? "60%" : c === 1 ? "40%" : "70%",
            }} />
          ))}
        </div>
      ))}
    </div>
  );
}
