"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useClientNav } from "./ClientPages";
import { ChainIcon, Icon, Tooltip, TokenIcon, Modal, ModalHeader } from "../atoms";
import { useWatchlist } from "../../lib/watchlist";
import { useHiddenMints } from "../../lib/hiddenTokens";
import { useLastSeen } from "../../contexts/LastSeenContext";
import { useLiveTradePrices, type LivePrice } from "../../hooks/useLiveTradePrices";
import { useNativeUsd } from "../../hooks/useNativeUsd";
import { useTokenEnrichment } from "../../hooks/useTokenEnrichment";
import { enrichWithMeta } from "../../hooks/enrichToken";
import { fetchWalletHoldings } from "../../api/client";
import { fetchPublicMetadata } from "../../api/metadata";
import { readUserWallets } from "../../lib/userWalletsMirror";
import { tokenHref } from "../../lib/tokenHref";
import { getActiveChain, nativeSymbol } from "../../lib/chains";
import { fmtMcap, fmtUsd, fmtPrice } from "../../lib/format";
import {
  useTickerBar,
  type TickerSource,
  type TickerSortField,
  type TickerNativeCurrency,
} from "../../hooks/useTickerBar";
import { useIsMobile } from "../../hooks/useMediaQuery";
import type { TokenEvent } from "../../types";

const SOURCE_TABS: { id: TickerSource; label: string; icon: (s: number) => React.ReactNode }[] = [
  { id: "watchlist", label: "Watchlist",        icon: (s) => Icon.starLine(s) },
  { id: "positions", label: "Active positions",  icon: (s) => Icon.lineChart(s) },
  { id: "recent",    label: "Recent pairs",      icon: (s) => Icon.history(s) },
];

export function TickerBar() {
  const { enabled, source } = useTickerBar();
  const isMobile = useIsMobile();
  if (!enabled || isMobile) return null;
  return <TickerBarInner source={source} />;
}

function TickerBarInner({ source }: { source: TickerSource }) {
  const watchlist = useWatchlist();
  const { lastSeen } = useLastSeen();
  const { sortField, sortDir, showMcaps, showHidden, nativeCurrency } = useTickerBar();
  const hiddenMints = useHiddenMints();
  const solPrice = useNativeUsd();

  const positions = usePositionSource(source === "positions");
  const recent = useRecentSource(source === "recent" ? lastSeen : null, watchlist);

  // Raw TokenEvent list for the active source (positions also carry a usd map).
  const { baseTokens, usdByMint } = useMemo(() => {
    let toks: TokenEvent[];
    let usd = EMPTY_USD;
    switch (source) {
      case "watchlist": toks = watchlist.entries.map((e) => e.snapshot); break;
      case "positions":
        toks = showHidden ? positions.tokens : positions.tokens.filter((t) => !hiddenMints.has(t.mint_address));
        usd = positions.usd;
        break;
      case "recent":    toks = recent; break;
    }
    return { baseTokens: toks, usdByMint: usd };
  }, [source, watchlist.entries, positions, recent, showHidden, hiddenMints]);

  // Enrich the snapshots through the same pipeline as the stream columns so
  // market cap / price / image fill in (raw snapshots have mcap 0).
  const [tokens, setTokens] = useState<TokenEvent[]>([]);
  const [enrichKey, setEnrichKey] = useState(0);
  const mintsKeyRef = useRef("");
  useEffect(() => {
    const key = baseTokens.map((t) => t.mint_address).join(",");
    if (key === mintsKeyRef.current) return;
    mintsKeyRef.current = key;
    setTokens(baseTokens);
    setEnrichKey((k) => k + 1);
    baseTokens.forEach((t) => enrichWithMeta(t, setTokens));
  }, [baseTokens]);
  useTokenEnrichment(tokens, setTokens, 30, enrichKey);

  const mints = useMemo(() => tokens.map((t) => t.mint_address), [tokens]);
  const initialPrices = useMemo(
    () => Object.fromEntries(tokens.flatMap((t) => (t.lastPrice && t.lastPrice > 0 ? [[t.mint_address, t.lastPrice]] : []))),
    [tokens],
  );
  const liveMap = useLiveTradePrices(mints, initialPrices);

  const sorted = useMemo(() => {
    const arr = [...tokens];
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortField === "name") arr.sort((a, b) => (a.symbol || "").localeCompare(b.symbol || "") * dir);
    else if (sortField === "price") arr.sort((a, b) => (((usdByMint.get(b.mint_address) ?? b.marketCap ?? b.lastPrice ?? 0) - (usdByMint.get(a.mint_address) ?? a.marketCap ?? a.lastPrice ?? 0)) * (dir === 1 ? -1 : 1)));
    else if (dir === 1) arr.reverse();
    return arr;
  }, [tokens, sortField, sortDir, usdByMint]);

  return (
    <div style={{
      display: "flex", alignItems: "center", height: 34,
      background: "var(--ink-1)", borderBottom: "1px solid var(--line-soft)",
      flexShrink: 0, position: "relative", zIndex: 9, paddingLeft: 6,
    }}>
      <TickerControls source={source} />
      <span style={{ width: 1, height: 18, background: "var(--line-soft)", margin: "0 8px", flexShrink: 0 }} />
      {sorted.length === 0 ? (
        <span style={{ fontSize: 11, color: "var(--paper-4)", paddingLeft: 4 }}>No tokens here yet</span>
      ) : (
        <div className="topbar-nav-scroll" style={{ display: "flex", alignItems: "center", gap: 4, overflowX: "auto", overflowY: "hidden", minWidth: 0, flex: 1, height: "100%", scrollbarWidth: "none", msOverflowStyle: "none" }}>
          <style>{`.topbar-nav-scroll::-webkit-scrollbar{display:none}`}</style>
          {sorted.map((t) => (
            <TickerChip
              key={t.mint_address}
              t={t}
              live={liveMap.get(t.mint_address)}
              solPrice={solPrice ?? undefined}
              usd={usdByMint.get(t.mint_address)}
              isPosition={source === "positions"}
              showMcaps={showMcaps}
              nativeCurrency={nativeCurrency}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TickerChip({
  t, live, solPrice, usd, isPosition, showMcaps, nativeCurrency,
}: {
  t: TokenEvent;
  live: LivePrice | undefined;
  solPrice: number | undefined;
  usd: number | undefined;
  isPosition: boolean;
  showMcaps: boolean;
  nativeCurrency: TickerNativeCurrency;
}) {
  const { navigate } = useClientNav();
  const [hover, setHover] = useState(false);

  const symbol = t.symbol || t.name || t.mint_address.slice(0, 4);
  const priceSol = live?.price ?? t.lastPrice ?? 0;
  const computedMcap = priceSol > 0 && solPrice ? priceSol * 1_000_000_000 * solPrice : undefined;
  const mcap = (t.marketCap && t.marketCap > 0 ? t.marketCap : undefined) ?? computedMcap;
  const priceUsd = priceSol && solPrice ? priceSol * solPrice : undefined;

  const change = t.priceChange;
  const changeUp = live?.flash === "up" || (live?.flash == null && (change ?? 0) > 0);
  const changeDown = live?.flash === "down" || (live?.flash == null && (change ?? 0) < 0);
  const valueColor = changeUp ? "var(--buy)" : changeDown ? "var(--sell)" : "var(--paper-2)";

  let value = "—";
  let secondary: string | null = null;
  if (isPosition && usd != null && usd > 0) {
    const nat = nativeSymbol(getActiveChain());
    const valStr = nativeCurrency === "sol" && solPrice ? `${(usd / solPrice).toFixed(2)} ${nat}` : fmtUsd(usd);
    // Value of the position, then the token's 24h price change.
    value = valStr;
    if (change != null) secondary = `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
    if (showMcaps && mcap != null && mcap > 0) secondary = fmtMcap(mcap);
  } else {
    value = mcap != null && mcap > 0 ? fmtMcap(mcap) : priceUsd != null && priceUsd > 0 ? fmtPrice(priceUsd) : "—";
  }

  return (
    <button
      type="button"
      onClick={() => navigate(tokenHref(t.mint_address))}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 9px", background: hover ? "var(--ink-2)" : "transparent", border: 0, borderRadius: 6, cursor: "pointer", flexShrink: 0, transition: "background 120ms" }}
    >
      <TokenIcon token={{ mint_address: t.mint_address, symbol, image: t.image ?? undefined }} size={15} />
      <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--paper)", whiteSpace: "nowrap" }}>{symbol}</span>
      <span className="mono" style={{ fontSize: 11, color: valueColor, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{value}</span>
      {secondary && <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)", whiteSpace: "nowrap" }}>{secondary}</span>}
    </button>
  );
}

/* ── controls ─────────────────────────────────────────────────────── */

function TickerControls({ source }: { source: TickerSource }) {
  const { setSource } = useTickerBar();
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
      <Tooltip content="Ticker settings" placement="bottom">
        <button type="button" aria-label="Ticker settings" onClick={() => setSettingsOpen(true)} style={ctrlBtn(false)}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--paper)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--paper-3)")}
        >
          {Icon.settings3(14)}
        </button>
      </Tooltip>
      <CtrlDivider />
      {SOURCE_TABS.map((tab) => {
        const active = tab.id === source;
        return (
          <Tooltip key={tab.id} content={tab.label} placement="bottom">
            <button type="button" aria-label={tab.label} aria-pressed={active} onClick={() => setSource(tab.id)} style={ctrlBtn(active)}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "var(--paper)"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "var(--paper-3)"; }}
            >
              {tab.icon(14)}
            </button>
          </Tooltip>
        );
      })}
      <TickerSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} source={source} />
    </div>
  );
}

function CtrlDivider() {
  return <span style={{ width: 1, height: 16, background: "var(--line-soft)", margin: "0 5px", flexShrink: 0 }} />;
}
function ctrlBtn(active: boolean): React.CSSProperties {
  return { width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center", background: active ? "var(--ink-2)" : "transparent", border: 0, borderRadius: 5, color: active ? "var(--accent)" : "var(--paper-3)", cursor: "pointer", transition: "color 120ms, background 120ms" };
}

/* ── positions source ─────────────────────────────────────────────── */

const EMPTY_USD = new Map<string, number>();

function usePositionSource(active: boolean): { tokens: TokenEvent[]; usd: Map<string, number> } {
  const [state, setState] = useState<{ tokens: TokenEvent[]; usd: Map<string, number> }>({ tokens: [], usd: EMPTY_USD });
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const addrs = readUserWallets().map((w) => w.address);
    if (addrs.length === 0) { setState({ tokens: [], usd: EMPTY_USD }); return; }
    void (async () => {
      const results = await Promise.allSettled(addrs.map((a) => fetchWalletHoldings(a)));
      if (cancelled) return;
      const usd = new Map<string, number>();
      const tok = new Map<string, TokenEvent>();
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        for (const h of r.value.data ?? []) {
          if (h.isNative) continue;
          if ((h.usdValue ?? 0) <= 0 && h.amount <= 0) continue;
          usd.set(h.mint, (usd.get(h.mint) ?? 0) + (h.usdValue ?? 0));
          if (!tok.has(h.mint)) {
            tok.set(h.mint, { mint_address: h.mint, name: h.name ?? "", symbol: h.symbol ?? "", dex: "", image: h.image ?? null, created_at: "" });
          }
        }
      }
      const tokens = [...tok.values()].sort((a, b) => (usd.get(b.mint_address) ?? 0) - (usd.get(a.mint_address) ?? 0));
      setState({ tokens, usd });
    })();
    return () => { cancelled = true; };
  }, [active]);
  return active ? state : { tokens: [], usd: EMPTY_USD };
}

/* ── recent source ────────────────────────────────────────────────── */

function useRecentSource(
  lastSeen: Record<string, number> | null,
  watchlist: ReturnType<typeof useWatchlist>,
): TokenEvent[] {
  const [meta, setMeta] = useState<Record<string, TokenEvent>>({});
  const mints = useMemo(() => {
    if (!lastSeen) return [] as string[];
    return Object.entries(lastSeen).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([m]) => m);
  }, [lastSeen]);
  const known = useMemo(() => {
    const m = new Map<string, TokenEvent>();
    for (const e of watchlist.entries) m.set(e.mint, e.snapshot);
    return m;
  }, [watchlist.entries]);
  useEffect(() => {
    if (mints.length === 0) return;
    const missing = mints.filter((m) => !known.has(m) && !meta[m]);
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const results = await Promise.allSettled(missing.map((m) => fetchPublicMetadata(m).then((md) => ({ m, md }))));
      if (cancelled) return;
      const next: Record<string, TokenEvent> = {};
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { m, md } = r.value;
        next[m] = { mint_address: m, name: md.name ?? "", symbol: md.symbol ?? "", dex: "", image: md.image ?? null, created_at: "" };
      }
      if (Object.keys(next).length) setMeta((prev) => ({ ...prev, ...next }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mints.join(","), known]);
  return useMemo(() => {
    if (!lastSeen) return EMPTY_TOKENS;
    return mints.map((m) => known.get(m) ?? meta[m] ?? { mint_address: m, name: "", symbol: m.slice(0, 4), dex: "", image: null, created_at: "" });
  }, [lastSeen, mints, known, meta]);
}

const EMPTY_TOKENS: TokenEvent[] = [];

/* ── settings modal (Axiom-style) ─────────────────────────────────── */

const SORT_LABELS: Record<TickerSortField, string> = {
  price: "Price", name: "Name", added: "Added",
};

function TickerSettingsModal({ open, onClose, source }: { open: boolean; onClose: () => void; source: TickerSource }) {
  const {
    sortField, setSortField, sortDir, setSortDir,
    showMcaps, setShowMcaps, showHidden, setShowHidden,
    nativeCurrency, setNativeCurrency,
  } = useTickerBar();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<"watchlist" | "positions">(source === "positions" ? "positions" : "watchlist");
  const [sortOpen, setSortOpen] = useState(false);
  const chainId = getActiveChain();
  const nat = nativeSymbol(chainId);

  return (
    <Modal open={open} onClose={onClose} width={440} align="center" mobileVariant={isMobile ? "sheet" : "center"}>
      <ModalHeader title="Ticker Row Settings" onClose={onClose} />

      <div style={{ padding: "16px 20px", background: "var(--ink-1)", overflow: "auto" }}>
        <div style={{ display: "inline-flex", gap: 4, background: "var(--ink-0)", borderRadius: 999, padding: 3, marginBottom: 14 }}>
          <TabPill active={tab === "watchlist"} label="Watchlist" onClick={() => setTab("watchlist")} />
          <TabPill active={tab === "positions"} label="Positions" onClick={() => setTab("positions")} />
        </div>

        {tab === "watchlist" ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, position: "relative" }}>
            <span style={{ fontSize: 12.5, color: "var(--paper)" }}>Sort Watchlist by</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
              <button type="button" onClick={() => setSortOpen((v) => !v)} style={dropdownBtn}>
                <span style={{ flex: 1, textAlign: "left" }}>{SORT_LABELS[sortField]}</span>
                <Chevron open={sortOpen} />
              </button>
              <button type="button" aria-label="Sort direction" onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")} style={sortDirBtn}>
                <SortDirIcon dir={sortDir} />
              </button>
              {sortOpen && (
                <div style={dropdownMenu} role="listbox">
                  {(Object.keys(SORT_LABELS) as TickerSortField[]).map((f) => (
                    <button key={f} type="button" role="option" aria-selected={sortField === f}
                      onClick={() => { setSortField(f); setSortOpen(false); }}
                      style={dropdownItem(sortField === f)}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ink-2)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = sortField === f ? "var(--ink-2)" : "transparent")}
                    >
                      {SORT_LABELS[f]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <ToggleRow label="Show Active Positions Market Caps" on={showMcaps} onChange={setShowMcaps} />
            <ToggleRow label="Show hidden positions" on={showHidden} onChange={setShowHidden} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 16 }}>
              <span style={{ fontSize: 12.5, color: "var(--paper)" }}>Show Positions in Native Currency</span>
              <div style={{ display: "flex", gap: 8 }}>
                <CurrencyCard active={nativeCurrency === "sol"} onClick={() => setNativeCurrency("sol")} label={nat} icon={<ChainIcon id={chainId} size={16} />} />
                <CurrencyCard active={nativeCurrency === "usd"} onClick={() => setNativeCurrency("usd")} label="USD" icon={<span style={{ fontSize: 15, fontWeight: 700, color: "var(--paper)" }}>$</span>} />
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line-soft)" }}>
        <button type="button" onClick={onClose} style={{ width: "100%", height: 38, borderRadius: 8, fontSize: 13, fontWeight: 700, background: "var(--accent)", color: "var(--ink-0)", border: 0, cursor: "pointer" }}>Done</button>
      </div>
    </Modal>
  );
}

function CurrencyCard({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} style={{ ...cardStyle(active), width: 72 }}>
      <div style={{ height: 34, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--ink-0)", borderRadius: 7 }}>{icon}</div>
      <span style={cardLabel(active)}>{label}</span>
    </button>
  );
}
function TabPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} style={{ padding: "5px 14px", borderRadius: 999, border: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, background: active ? "var(--ink-2)" : "transparent", color: active ? "var(--paper)" : "var(--paper-3)", transition: "background 120ms, color 120ms" }}>{label}</button>
  );
}
function ToggleRow({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 16 }}>
      <span style={{ fontSize: 12.5, color: "var(--paper)" }}>{label}</span>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} style={{ position: "relative", width: 40, height: 22, flexShrink: 0, borderRadius: 999, border: 0, background: on ? "var(--accent)" : "var(--ink-3)", cursor: "pointer", transition: "background 140ms" }}>
      <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: 999, background: "#fff", transition: "left 140ms" }} />
    </button>
  );
}
function cardStyle(active: boolean): React.CSSProperties {
  return { display: "flex", flexDirection: "column", gap: 7, padding: 5, background: "var(--ink-0)", borderRadius: 9, cursor: "pointer", border: active ? "2px solid var(--accent)" : "2px solid var(--line-soft)", boxShadow: active ? "0 0 0 3px color-mix(in oklch, var(--accent) 18%, transparent)" : "none", transition: "border-color 120ms, box-shadow 120ms" };
}
function cardLabel(active: boolean): React.CSSProperties {
  return { fontSize: 11, textAlign: "center", color: active ? "var(--paper)" : "var(--paper-3)", fontWeight: active ? 600 : 500, paddingBottom: 2 };
}
const dropdownBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, minWidth: 128, padding: "7px 10px", background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 7, color: "var(--paper)", fontSize: 12, cursor: "pointer" };
const sortDirBtn: React.CSSProperties = { width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 7, color: "var(--paper-2)", cursor: "pointer" };
const dropdownMenu: React.CSSProperties = { position: "absolute", top: "100%", right: 40, marginTop: 4, minWidth: 150, background: "var(--ink-1)", border: "1px solid var(--line-soft)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", padding: 4, zIndex: 5 };
function dropdownItem(active: boolean): React.CSSProperties {
  return { display: "block", width: "100%", textAlign: "left", padding: "8px 10px", background: active ? "var(--ink-2)" : "transparent", border: 0, borderRadius: 5, color: active ? "var(--paper)" : "var(--paper-2)", fontSize: 12, cursor: "pointer" };
}
function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: "var(--paper-4)" }}>
      <path d="M2.2 3.6 5 6.4l2.8-2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transformOrigin: "50% 50%", transition: "transform 120ms" }} />
    </svg>
  );
}
function SortDirIcon({ dir }: { dir: "asc" | "desc" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ transform: dir === "asc" ? "scaleY(-1)" : "none" }}>
      <path d="M4 4h9M4 8h6M4 12h3M12.5 7.5v5m0 0 1.8-1.8M12.5 12.5l-1.8-1.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
