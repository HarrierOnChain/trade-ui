"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTrades, type TradeTimeRange } from "../../hooks/useTrades";
import { useFreezeSnapshotOnHover } from "../../hooks/useFreezeSnapshotOnHover";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useSelectedToken } from "../../contexts/SelectedTokenContext";
import { useApp } from "../../contexts/AppContext";
import { formatAge, registerAge, unregisterAge } from "../../lib/ageRegistry";
import { Icon, Tooltip, ChainIcon } from "../atoms";
import { WalletLabel } from "../../hooks/useWalletLabels";
import { mergeTradeLists, tradeLegKey, tradeNative } from "../../lib/trades";
import {
  formatTimestampRangeShort,
  msToDatetimeLocal,
  parseDatetimeLocal,
} from "../../lib/chartInterval";
import { explorerName, explorerTxUrl, getActiveChain, nativeSymbol } from "../../lib/chains";
import type { Trade } from "../../types";
import styles from "./styles.module.css";

type TimeMode = "age" | "time";
const COL_COUNT = 6;

interface Props {
  mint?: string | null;
  solPrice?: number;
  supply?: number;
  currency?: "usd" | "sol";
  display?: "mcap" | "price";
  signer?: string | null;
  devSigner?: string | null;
  /**
   * Client-side signer filter for one wallet category (DEV / TRACKED / YOU).
   * `null`/undefined means no category filter is active.
   */
  categorySigners?: Set<string> | null;
  /** Inclusive amount filter in SOL — null means no bound. */
  amountMinSol?: number | null;
  amountMaxSol?: number | null;
  /** Inclusive timestamp filter in unix ms — null means no bound. */
  timestampMinMs?: number | null;
  timestampMaxMs?: number | null;
  onTimestampRangeChange?: (range: { minMs: number | null; maxMs: number | null }) => void;
  /**
   * Extra trades to merge into the fetched list (de-duped by (signature, wallet)).
   * Used for DEMO wallet fills which aren't on the upstream history
   * feed but should still appear in the user's transaction view.
   */
  extraTrades?: Trade[];
  /** Optional trigger rendered next to the "Total SOL/USD" header (e.g. amount filter popover). */
  renderTotalHeaderSlot?: () => React.ReactNode;
  onCurrencyChange?: (c: "usd" | "sol") => void;
  onDisplayChange?: (d: "mcap" | "price") => void;
  onAddressClick?: (address: string) => void;
}

function toMs(raw: string | number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!isNaN(n) && n > 0) return n > 1e15 ? n / 1000 : n > 1e12 ? n : n * 1000;
  return new Date(raw as string).getTime();
}

function formatClock(tsMs: number): string {
  const d = new Date(tsMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function TimeCell({ tsMs, mode, frozen }: { tsMs: number; mode: TimeMode; frozen?: boolean }) {
  const ref = useRef<HTMLTableCellElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (mode === "age" && !frozen) {
      el.textContent = formatAge(tsMs);
      registerAge(el, tsMs);
      return () => unregisterAge(el);
    } else {
      unregisterAge(el);
      el.textContent = formatClock(tsMs);
    }
  }, [tsMs, mode, frozen]);
  return <td ref={ref} data-label={mode === "age" ? "Age" : "Time"} className={styles.time}>{mode === "age" && !frozen ? formatAge(tsMs) : formatClock(tsMs)}</td>;
}

export function TradesTable({
  mint: mintProp,
  solPrice = 0,
  supply = 0,
  currency = "sol",
  display = "mcap",
  signer,
  devSigner,
  categorySigners,
  amountMinSol,
  amountMaxSol,
  timestampMinMs,
  timestampMaxMs,
  onTimestampRangeChange,
  extraTrades,
  renderTotalHeaderSlot,
  onCurrencyChange,
  onDisplayChange,
  onAddressClick,
}: Props) {
  const ctx = useSelectedToken();
  const mint = mintProp ?? ctx?.selectedMint;
  const [sortAsc, setSortAsc] = useState(false);
  const timeRange = useMemo<TradeTimeRange>(
    () => ({ fromMs: timestampMinMs, toMs: timestampMaxMs }),
    [timestampMinMs, timestampMaxMs],
  );
  const serverTimeFilter =
    (timestampMinMs != null && isFinite(timestampMinMs)) ||
    (timestampMaxMs != null && isFinite(timestampMaxMs));
  const { trades, loading, loadingMore, hasMore, morePaused, error, loadMore } =
    useTrades(mint ?? null, signer, sortAsc ? "asc" : "desc", timeRange);
  const [timeMode, setTimeMode] = useState<TimeMode>("age");
  const [timestampFilterOpen, setTimestampFilterOpen] = useState(false);
  const timestampFilterRef = useRef<HTMLSpanElement>(null);
  const timestampFilterActive =
    (timestampMinMs != null && isFinite(timestampMinMs)) ||
    (timestampMaxMs != null && isFinite(timestampMaxMs));

  useEffect(() => {
    if (!timestampFilterOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!timestampFilterRef.current?.contains(e.target as Node)) {
        setTimestampFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [timestampFilterOpen]);

  // Merge in any extra trades (e.g. DEMO fills): a tape row the extras hold
  // (same signature and wallet) is taken from them; the tape's own rows all
  // stay (co-signers, EVM legs). Then apply the category / amount filters.
  const merged = useMemo(() => {
    const out = mergeTradeLists(extraTrades ?? [], trades);
    return out.sort((a, b) => {
      const ta = toMs(a.timestamp);
      const tb = toMs(b.timestamp);
      return sortAsc ? ta - tb : tb - ta;
    });
  }, [trades, extraTrades, sortAsc]);

  const sorted = useMemo(() => {
    const hasCatFilter = categorySigners && categorySigners.size > 0;
    const hasMin = amountMinSol != null && isFinite(amountMinSol);
    const hasMax = amountMaxSol != null && isFinite(amountMaxSol);
    const hasTsMin = !serverTimeFilter && timestampMinMs != null && isFinite(timestampMinMs);
    const hasTsMax = !serverTimeFilter && timestampMaxMs != null && isFinite(timestampMaxMs);
    if (!hasCatFilter && !hasMin && !hasMax && !hasTsMin && !hasTsMax) return merged;
    return merged.filter((t) => {
      if (hasCatFilter && !categorySigners!.has(t.signer)) return false;
      if (hasMin || hasMax) {
        // A row with no volume can't be placed in an amount range.
        const amt = tradeNative(t);
        if (amt == null) return false;
        if (hasMin && amt < (amountMinSol as number)) return false;
        if (hasMax && amt > (amountMaxSol as number)) return false;
      }
      const ts = toMs(t.timestamp);
      if (hasTsMin && ts < (timestampMinMs as number)) return false;
      if (hasTsMax && ts > (timestampMaxMs as number)) return false;
      return true;
    });
  }, [merged, categorySigners, amountMinSol, amountMaxSol, timestampMinMs, timestampMaxMs, serverTimeFilter]);

  const { displayed: displayedTrades, hovered: tableHovered, handlers: freezeHandlers } =
    useFreezeSnapshotOnHover(sorted);

  const { sentinelRef, rootRef } = useInfiniteScroll<HTMLTableRowElement, HTMLDivElement>(
    loadMore,
    hasMore && !loading && !loadingMore && !morePaused && !tableHovered,
  );

  // New mint / filter — jump back to the top so live rows sit under the header
  // instead of inheriting scroll depth from the previous token.
  useEffect(() => {
    rootRef.current?.scrollTo({ top: 0 });
  }, [mint, signer, sortAsc, timestampMinMs, timestampMaxMs, rootRef]);

  const tradesByWallet = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of trades) map.set(t.signer, (map.get(t.signer) ?? 0) + 1);
    return map;
  }, [trades]);

  const mountTime = useRef(Date.now());

  useEffect(() => {
    mountTime.current = Date.now();
  }, [mint]);

  const toggleCurrency = () =>
    onCurrencyChange?.(currency === "sol" ? "usd" : "sol");
  const toggleDisplay = () =>
    onDisplayChange?.(display === "mcap" ? "price" : "mcap");

  return (
    <div className={styles.container}>
      <div
        className={styles.tableWrap}
        ref={rootRef}
        {...freezeHandlers}
      >
        {tableHovered && (
          <span className={styles.freezeBadge} aria-hidden>
            Paused
          </span>
        )}
        <table className={`${styles.table} table-cards`}>
          <colgroup>
            <col className={styles.cTime} />
            <col className={styles.cSide} />
            <col className={styles.cPrice} />
            <col className={styles.cTokens} />
            <col className={styles.cTotal} />
            <col className={styles.cTrader} />
          </colgroup>
          <thead>
            <tr>
              <Tooltip content="Toggle sort order">
                <th
                  className={`${styles.thLeft} ${styles.sortable}`}
                  onClick={() => setSortAsc((v) => !v)}
                >
                  <span className={styles.thLabel}>
                    <span
                      className={`${styles.thSwitch} ${timeMode === "age" ? styles.thSwitchActive : ""}`}
                      onClick={(e) => { e.stopPropagation(); setTimeMode("age"); }}
                    >Age</span>
                    <span className={styles.thSlash}>/</span>
                    <span
                      className={`${styles.thSwitch} ${timeMode === "time" ? styles.thSwitchActive : ""}`}
                      onClick={(e) => { e.stopPropagation(); setTimeMode("time"); }}
                    >Time</span>
                    {sortAsc ? Icon.arrowUp(10) : Icon.arrowDown(10)}
                    {onTimestampRangeChange && (
                      <span
                        ref={timestampFilterRef}
                        className={styles.timeFilterWrap}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Tooltip content={timestampFilterActive ? "Edit time filter" : "Filter by timestamp range"}>
                          <button
                            type="button"
                            className={`${styles.timeFilterBtn} ${timestampFilterActive ? styles.timeFilterBtnActive : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setTimestampFilterOpen((v) => !v);
                            }}
                            aria-expanded={timestampFilterOpen}
                            aria-haspopup="dialog"
                          >
                            {Icon.clock(11)}
                            {timestampFilterActive && (
                              <span className={styles.timeFilterBadge}>
                                {timestampMinMs != null && timestampMaxMs != null
                                  ? formatTimestampRangeShort(timestampMinMs, timestampMaxMs)
                                  : timestampMinMs != null
                                    ? `from ${msToDatetimeLocal(timestampMinMs).slice(11)}`
                                    : `to ${msToDatetimeLocal(timestampMaxMs!).slice(11)}`}
                              </span>
                            )}
                          </button>
                        </Tooltip>
                        {timestampFilterOpen && (
                          <TimestampFilterPopover
                            minMs={timestampMinMs ?? null}
                            maxMs={timestampMaxMs ?? null}
                            onChange={onTimestampRangeChange}
                            onClose={() => setTimestampFilterOpen(false)}
                          />
                        )}
                      </span>
                    )}
                  </span>
                </th>
              </Tooltip>
              <th className={styles.thLeft}>Type</th>
              <Tooltip content={`Switch to ${display === "mcap" ? "Price" : "Market Cap"}`}>
                <th
                  className={`${styles.thRight} ${styles.sortable}`}
                  onClick={toggleDisplay}
                >
                  <span className={styles.thLabel}>
                    {display === "mcap" ? "MC" : "Price"}
                    <span className={styles.thIcon}>{swapIcon(10)}</span>
                  </span>
                </th>
              </Tooltip>
              <th className={styles.thRight}>Tokens</th>
              <th className={styles.thRight}>
                <span className={styles.thLabel} style={{ gap: 8 }}>
                  <Tooltip content={`Switch to ${currency === "sol" ? "USD" : nativeSymbol(getActiveChain())}`}>
                    <span
                      onClick={toggleCurrency}
                      style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      {currency === "sol" ? `Total ${nativeSymbol(getActiveChain())}` : "Total USD"}
                      <span className={styles.thIcon}>{dollarIcon(10)}</span>
                    </span>
                  </Tooltip>
                  {renderTotalHeaderSlot?.()}
                </span>
              </th>
              <th className={styles.thRight}>Trader</th>
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr><td colSpan={COL_COUNT} className={styles.error}>{error}</td></tr>
            )}
            {loading && trades.length === 0 && Array.from({ length: 12 }).map((_, i) => (
              <tr key={i} className={styles.skRow}>
                {Array.from({ length: COL_COUNT }).map((__, j) => (
                  <td key={j}><div className="skeleton" style={{ height: 12, borderRadius: 3 }} /></td>
                ))}
              </tr>
            ))}
            {!loading && displayedTrades.length === 0 && !error && (
              <tr>
                <td colSpan={COL_COUNT} className={styles.empty}>
                  <span className={styles.emptyIcon}>{Icon.chart(22)}</span>
                  {signer
                    ? "No trades for this wallet on this token"
                    : timestampFilterActive
                      ? "No trades in this time range"
                      : categorySigners && categorySigners.size > 0
                        ? "No matching trades in the current feed"
                        : mint
                          ? "Waiting for trades…"
                          : "Select a token"}
                </td>
              </tr>
            )}
            {displayedTrades.map((t) => {
              const tsMs = toMs(t.timestamp);
              const isFresh = tsMs > mountTime.current && Date.now() - tsMs < 3000;
              return (
                <TradeRow
                  key={tradeLegKey(t)}
                  trade={t}
                  tsMs={tsMs}
                  timeMode={timeMode}
                  solPrice={solPrice}
                  supply={supply}
                  currency={currency}
                  display={display}
                  devSigner={devSigner}
                  walletCount={tradesByWallet.get(t.signer) ?? 0}
                  onAddressClick={onAddressClick}
                  isFresh={isFresh}
                />
              );
            })}
            {hasMore && !loading && (
              <tr ref={sentinelRef}>
                <td colSpan={COL_COUNT} className={styles.sentinel} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {loadingMore && (
        <div className={styles.loadMoreBar}>
          <span className={styles.spinner} />
          <span>Loading more trades…</span>
        </div>
      )}
    </div>
  );
}

const TradeRow = React.memo(function TradeRow({
  trade,
  tsMs,
  timeMode,
  solPrice,
  supply,
  currency,
  display,
  devSigner,
  walletCount,
  onAddressClick,
  isFresh,
}: {
  trade: Trade;
  tsMs: number;
  timeMode: TimeMode;
  solPrice: number;
  supply: number;
  currency: "usd" | "sol";
  display: "mcap" | "price";
  devSigner?: string | null;
  walletCount: number;
  onAddressClick?: (a: string) => void;
  isFresh: boolean;
}) {
  const { openWalletModal } = useApp();
  const isBuy = trade.transactionType === "buy";
  const isDev = (!!devSigner && trade.signer === devSigner) || !!trade.tags?.includes("dev");
  const flags = tradeFlags(trade, isDev);
  // The flag column is narrow: past MAX_FLAGS the rest fold into one "+n" chip.
  const shown = flags.length > MAX_FLAGS ? flags.slice(0, MAX_FLAGS - 1) : flags;
  const folded = flags.slice(shown.length);

  const avgP = trade.avgPrice || 0;
  let mcapOrPrice = "–";
  if (display === "mcap") {
    const mc = avgP * solPrice * supply;
    if (mc > 0) mcapOrPrice = fmtUsdCompact(mc);
  } else {
    const price = avgP * solPrice;
    if (price > 0) mcapOrPrice = fmtPriceCompact(price);
  }

  // Unknown volume renders "–" (never "0"), with no bar and the lightest tint.
  const native = tradeNative(trade);
  const solAmt = native ?? 0;
  const usd = native != null && solPrice > 0
    ? native * solPrice
    : typeof trade.usdValue === "number" && Number.isFinite(trade.usdValue) ? trade.usdValue : null;
  const totalLabel =
    currency === "usd" && solPrice > 0
      ? usd != null ? fmtUsdCompact(usd) : "–"
      : native != null ? native.toFixed(native >= 100 ? 1 : native >= 1 ? 2 : 3) : "–";

  const pct = volumeBarPct(solAmt);
  const tintPct = rowTintOpacity(solAmt);
  const rowStyle: React.CSSProperties = {
    background: `color-mix(in oklch, var(${isBuy ? "--buy" : "--sell"}) ${tintPct}%, transparent)`,
  };

  const addr = trade.signer;

  return (
    <tr
      className={`${styles.tradeRow} ${isBuy ? styles.buy : styles.sell} ${isFresh ? styles.fresh : ""}`}
      style={rowStyle}
    >
      {/* Preview trades (deploy form plan) are frozen — static clock, no ticking age. */}
      <TimeCell tsMs={tsMs} mode={timeMode} frozen={trade.signature.startsWith("preview-")} />
      <td data-label="Type" className={styles.tdLeft}>
        <span className={isBuy ? styles.typeBuy : styles.typeSell}>
          {isBuy ? "Buy" : "Sell"}
        </span>
      </td>
      <td data-label={display === "mcap" ? "MC" : "Price"} className={`${styles.mono} ${styles.tdRight}`}>{mcapOrPrice}</td>
      <td data-label="Tokens" className={`${styles.mono} ${styles.tdRight}`}>{fmtTokens(trade.tokensAmount)}</td>
      <td
        data-label={currency === "sol" ? `Total ${nativeSymbol(getActiveChain())}` : "Total USD"}
        className={`${styles.solCell} ${isBuy ? styles.solCellBuy : styles.solCellSell}`}
        style={{ ["--pct" as string]: pct } as React.CSSProperties}
      >
        <span className={styles.solLabel}>
          {currency === "sol" && native != null && <span className={styles.solGlyph}><ChainIcon id={getActiveChain()} size={11} /></span>}
          <span className={`${styles.mono} ${isBuy ? styles.amountBuy : styles.amountSell}`}>
            {totalLabel}
          </span>
        </span>
      </td>
      <td data-label="Trader" className={styles.traderCell}>
        <div className={styles.walletRow}>
          <Tooltip content={`Open wallet ${addr}`} mono>
            <button
              type="button"
              className={`${styles.addrText} ${styles.addrBtn}`}
              onClick={(e) => { e.stopPropagation(); openWalletModal(addr); }}
            >
              {addr ? <WalletLabel address={addr} chars={3} /> : "–"}
            </button>
          </Tooltip>
          <span className={styles.walletFlags}>
            {shown.map((f) => (
              <Tooltip key={f.key} content={f.title}>
                <span className={`${styles.flag} ${f.cls}`}>{f.body}</span>
              </Tooltip>
            ))}
            {folded.length > 0 && (
              <Tooltip content={folded.map((f) => f.title).join(" · ")}>
                <span className={`${styles.flag} ${styles.flagMuted}`}>+{folded.length}</span>
              </Tooltip>
            )}
            {walletCount > 1 && (
              <Tooltip content={`${walletCount} trades by this wallet in view`}>
                <span className={styles.tradesBadge}>{walletCount}</span>
              </Tooltip>
            )}
          </span>
          <span className={`${styles.rowActions} row-actions-hover`}>
            <Tooltip content={`View transaction on ${explorerName()}`}>
              <a
                href={explorerTxUrl(trade.signature)}
                target="_blank"
                rel="noreferrer"
                className={styles.iconBtn}
                onClick={(e) => e.stopPropagation()}
              >
                {Icon.ext(10)}
              </a>
            </Tooltip>
            <Tooltip content="Filter trades by this wallet">
              <button
                className={styles.iconBtn}
                onClick={(e) => { e.stopPropagation(); onAddressClick?.(addr); }}
              >
                {Icon.filter(11)}
              </button>
            </Tooltip>
          </span>
        </div>
      </td>
    </tr>
  );
});

const MAX_FLAGS = 2;

type Flag = { key: string; title: string; cls: string; body: React.ReactNode };

// The API's maker tags past bundle/sniper/pro (openapi `Trade.tags`), in the
// contract's vocabulary order. "dev" is folded into the dev chip.
const TAG_FLAGS: { tag: string; title: string; label: string; cls: string }[] = [
  { tag: "mev",       title: "MEV bot",      label: "MEV",  cls: styles.flagWarn },
  { tag: "insider",   title: "Insider",      label: "INS",  cls: styles.flagWarn },
  { tag: "smart",     title: "Smart money",  label: "SM",   cls: styles.flagBuy },
  { tag: "kol",       title: "KOL",          label: "KOL",  cls: styles.flagPro },
  { tag: "whale",     title: "Whale",        label: "WHL",  cls: "" },
  { tag: "fresh",     title: "Fresh wallet", label: "NEW",  cls: styles.flagMuted },
  { tag: "washtrade", title: "Wash trader",  label: "WASH", cls: styles.flagMuted },
  { tag: "sandwich",  title: "Sandwich bot", label: "SAND", cls: styles.flagSniper },
];

function tradeFlags(trade: Trade, isDev: boolean): Flag[] {
  const out: Flag[] = [];
  if (isDev) out.push({ key: "dev", title: "Dev Creator", cls: styles.flagDev, body: Icon.dev(11) });
  if (!isDev && trade.isBundle) out.push({ key: "bundle", title: "Bundle", cls: "", body: Icon.bundle(11) });
  if (!isDev && trade.isSniper) out.push({ key: "sniper", title: "Sniper", cls: styles.flagSniper, body: Icon.sniper(11) });
  if (trade.isProTrader) out.push({ key: "pro", title: "Pro Trader", cls: styles.flagPro, body: Icon.pro(11) });
  const tags = trade.tags;
  if (tags?.length) {
    for (const f of TAG_FLAGS) {
      if (tags.includes(f.tag)) out.push({ key: f.tag, title: f.title, cls: f.cls, body: f.label });
    }
  }
  return out;
}

// Inline icons used only for header toggles
function TimestampFilterPopover({
  minMs,
  maxMs,
  onChange,
  onClose,
}: {
  minMs: number | null;
  maxMs: number | null;
  onChange: (range: { minMs: number | null; maxMs: number | null }) => void;
  onClose: () => void;
}) {
  const [minInput, setMinInput] = useState(minMs != null ? msToDatetimeLocal(minMs) : "");
  const [maxInput, setMaxInput] = useState(maxMs != null ? msToDatetimeLocal(maxMs) : "");

  useEffect(() => {
    setMinInput(minMs != null ? msToDatetimeLocal(minMs) : "");
    setMaxInput(maxMs != null ? msToDatetimeLocal(maxMs) : "");
  }, [minMs, maxMs]);

  const apply = () => {
    onChange({
      minMs: parseDatetimeLocal(minInput),
      maxMs: parseDatetimeLocal(maxInput),
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label="Timestamp filter"
      className={styles.timeFilterPopover}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.timeFilterPopoverTitle}>Timestamp filter</div>
      <div className={styles.timeFilterFields}>
        <label className={styles.timeFilterField}>
          <span className={styles.timeFilterHint}>FROM</span>
          <input
            type="datetime-local"
            value={minInput}
            onChange={(e) => setMinInput(e.target.value)}
            className={styles.timeFilterInput}
          />
        </label>
        <label className={styles.timeFilterField}>
          <span className={styles.timeFilterHint}>TO</span>
          <input
            type="datetime-local"
            value={maxInput}
            onChange={(e) => setMaxInput(e.target.value)}
            className={styles.timeFilterInput}
          />
        </label>
      </div>
      <div className={styles.timeFilterActions}>
        <button
          type="button"
          className={styles.timeFilterActionSecondary}
          disabled={!minInput && !maxInput}
          onClick={() => {
            setMinInput("");
            setMaxInput("");
            onChange({ minMs: null, maxMs: null });
            onClose();
          }}
        >
          Clear
        </button>
        <button type="button" className={styles.timeFilterActionPrimary} onClick={apply}>
          Apply
        </button>
      </div>
    </div>
  );
}

function swapIcon(s = 10) {
  return (
    <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
      <path d="M2 4h7M7 2l2 2-2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 8H3M5 10 3 8l2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function dollarIcon(s = 10) {
  return (
    <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
      <path
        d="M6 2v8M4 4.5a1.5 1.5 0 0 1 1.5-1.5h1.8M7.5 9h-2A1.5 1.5 0 0 1 4 7.5M8 4.5 5.5 5l2 1.5-2 .5"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

// Piecewise-linear mapping from SOL amount to a bar-width percent. Fixed
// tiers keep the visual meaningful regardless of the current trade mix —
// one whale won't flatten the rest of the feed.
function volumeBarPct(sol: number): number {
  if (!isFinite(sol) || sol <= 0) return 0;
  if (sol >= 10)  return 100;
  if (sol >= 5)   return 75 + ((sol - 5)  / 5)  * 25;
  if (sol >= 2)   return 55 + ((sol - 2)  / 3)  * 20;
  if (sol >= 1)   return 40 + ((sol - 1)  / 1)  * 15;
  if (sol >= 0.5) return 25 + ((sol - 0.5)/ 0.5) * 15;
  if (sol >= 0.1) return 8  + ((sol - 0.1)/ 0.4) * 17;
  return Math.max(2, (sol / 0.1) * 8);
}

function rowTintOpacity(sol: number): number {
  if (sol >= 10)  return 22;
  if (sol >= 2)   return 15;
  if (sol >= 0.5) return 10;
  if (sol >= 0.1) return 6;
  return 3;
}

function fmtTokens(v?: number) {
  if (!v) return "–";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

function fmtUsdCompact(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  if (v >= 1)   return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function fmtPriceCompact(v: number): string {
  if (v < 1e-6) return `$${v.toExponential(2)}`;
  if (v < 0.01) return `$${v.toFixed(6)}`;
  if (v < 1) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}
