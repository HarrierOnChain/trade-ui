"use client";

/**
 * /discover — the chain's tokens ranked over a window, live: Trending (the
 * API's ranking, by trades) and Top (by volume), each over 1m to 24h. One row
 * per token: identity, market cap and the window's change, liquidity, the
 * window's volume and trades, and the holder checks. The live launch columns
 * are Trenches.
 */

import React, { useEffect, useState, type ReactNode } from "react";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useChain } from "../../contexts/ChainContext";
import { useRanking } from "../../hooks/useRanking";
import { useQuickBuy } from "../../hooks/useQuickBuy";
import { useQuickBuyAmount } from "../../hooks/useQuickBuyAmount";
import { useBuyQuoteMint } from "../../hooks/useBuyQuoteMint";
import { useHiddenMints } from "../../lib/hiddenTokens";
import { useClientNav } from "../../components/shell/ClientPages";
import {
  ColumnQuickBuyInput,
  Icon,
  QuoteAmount,
  TokenAvatarFrame,
  TokenPreviewCard,
  TokenSocialLinks,
  Tooltip,
} from "../../components/atoms";
import { formatAge } from "../../lib/ageRegistry";
import { fmtMcap, fmtNum, fmtPct, fmtUsd } from "../../lib/format";
import { tokenHref } from "../../lib/tokenHref";
import type { RankInterval, RankSort } from "../../api/client";
import type { TokenEvent } from "../../types";

type Tab = "top" | "trending";

const TABS: Array<{ id: Tab; label: string; sort: RankSort; hint: string }> = [
  { id: "top", label: "Top", sort: "volume", hint: "Most volume over the window" },
  { id: "trending", label: "Trending", sort: "trades", hint: "The API's trending ranking: most trades over the window" },
];
const INTERVALS: RankInterval[] = ["1m", "5m", "1h", "6h", "24h"];
const PREFS_KEY = "discover.view.v1";
const QUICK_BUY_SCOPE = "discover";

/** Above these shares a holding is a risk, and shows red. */
const RISK = { top10: 30, dev: 10, snipers: 10, insiders: 10, bundlers: 10 };

const COLS = "minmax(250px, 2.4fr) minmax(96px, 1fr) minmax(84px, 0.8fr) minmax(84px, 0.8fr) minmax(104px, 0.9fr) minmax(210px, 1.6fr) 84px";

const micro: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: "var(--paper-3)",
  whiteSpace: "nowrap",
};

function loadView(): { tab: Tab; interval: RankInterval } {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as { tab?: Tab; interval?: RankInterval } | null;
    return {
      tab: v?.tab === "top" ? "top" : "trending",
      interval: v?.interval && INTERVALS.includes(v.interval) ? v.interval : "1h",
    };
  } catch {
    return { tab: "trending", interval: "1h" };
  }
}

export default function DiscoverPage() {
  usePageTitle("Discover");
  const { chain } = useChain();
  const [tab, setTab] = useState<Tab>("trending");
  const [interval, setInterval_] = useState<RankInterval>("1h");
  useEffect(() => {
    const v = loadView();
    setTab(v.tab);
    setInterval_(v.interval);
  }, []);
  const choose = (next: { tab?: Tab; interval?: RankInterval }) => {
    const v = { tab: next.tab ?? tab, interval: next.interval ?? interval };
    setTab(v.tab);
    setInterval_(v.interval);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(v)); } catch { /* ignore */ }
  };

  const sort = TABS.find((t) => t.id === tab)!.sort;
  const { rows, loading, stale, error } = useRanking(interval, sort);
  const hidden = useHiddenMints();
  const shown = rows.filter((t) => !hidden.has(t.mint_address));

  // Ages tick without a re-read.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "20px 16px 40px" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div role="tablist" aria-label="Ranking" style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                title={t.hint}
                onClick={() => choose({ tab: t.id })}
                style={{
                  background: "transparent", border: 0, padding: 0, cursor: "pointer",
                  fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em",
                  color: tab === t.id ? "var(--paper)" : "var(--paper-4)",
                  transition: "color 120ms",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div role="group" aria-label="Window" style={{ display: "flex", gap: 2 }}>
              {INTERVALS.map((iv) => (
                <button
                  key={iv}
                  type="button"
                  aria-pressed={interval === iv}
                  onClick={() => choose({ interval: iv })}
                  className="mono"
                  style={{
                    background: interval === iv ? "var(--ink-2)" : "transparent",
                    border: 0, borderRadius: 6, padding: "6px 10px", cursor: "pointer",
                    fontSize: 13, fontWeight: 600,
                    color: interval === iv ? "var(--accent)" : "var(--paper-2)",
                  }}
                >
                  {iv}
                </button>
              ))}
            </div>
            <ColumnQuickBuyInput column={QUICK_BUY_SCOPE} />
          </div>
        </div>

        <div style={{ border: "1px solid var(--line-soft)", borderRadius: 10, background: "var(--ink-0)", overflowX: "auto" }}>
          <div style={{ minWidth: 1040 }}>
            <div
              role="row"
              style={{
                display: "grid", gridTemplateColumns: COLS, gap: 12, alignItems: "center",
                padding: "12px 16px", borderBottom: "1px solid var(--line-soft)",
                position: "sticky", top: 0, background: "var(--ink-0)", zIndex: 1,
              }}
            >
              <span style={micro}>Pair info · Age</span>
              <span style={micro}>Market cap</span>
              <span style={micro}>Liquidity</span>
              <span style={micro}>Volume {interval}</span>
              <span style={micro}>TXNS {interval}</span>
              <span style={micro}>Token info</span>
              <span style={{ ...micro, textAlign: "right" }}>Buy</span>
            </div>

            {error && shown.length === 0 && <Note>The ranking did not load: {error}</Note>}
            {loading && shown.length === 0 && !error && <SkeletonRows />}
            {!loading && !error && shown.length === 0 && <Note>No ranked tokens on {chain.name} over {interval} yet.</Note>}
            {/* The previous window's rows, dimmed, until the new ranking arrives. */}
            <div style={{ opacity: stale ? 0.45 : 1, transition: "opacity 160ms" }} aria-busy={stale}>
              {shown.map((t) => <Row key={t.mint_address} t={t} interval={interval} />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The table's shape while the first ranking loads. */
function SkeletonRows() {
  const bar = (w: number | string, h = 12): React.CSSProperties => ({
    width: w, height: h, borderRadius: 4,
    background: "linear-gradient(90deg, var(--ink-2) 0%, var(--line-soft) 50%, var(--ink-2) 100%)",
    backgroundSize: "400px 100%",
    animation: "shimmer 1.3s linear infinite",
  });
  return (
    <div aria-busy="true" aria-label="Loading the ranking">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line-soft)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ ...bar(55, 55), borderRadius: 12 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={bar(110, 13)} />
              <div style={bar(70, 10)} />
            </div>
          </div>
          <div style={bar(64)} />
          <div style={bar(56)} />
          <div style={bar(56)} />
          <div style={bar(60)} />
          <div style={bar(150)} />
          <div style={{ ...bar(60, 26), borderRadius: 999, justifySelf: "end" }} />
        </div>
      ))}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <div style={{ padding: "28px 16px", fontSize: 12.5, color: "var(--paper-3)", textAlign: "center" }}>{children}</div>;
}

const Row = React.memo(function Row({ t, interval }: { t: TokenEvent; interval: RankInterval }) {
  const { navigate } = useClientNav();
  const w = t.windows?.[interval];
  const change = w?.priceChangePercent;
  const born = t.created_at ? Date.parse(t.created_at) : NaN;

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => navigate(tokenHref(t.mint_address, t.chain))}
      onKeyDown={(e) => { if (e.key === "Enter") navigate(tokenHref(t.mint_address, t.chain)); }}
      className="discover-row"
      style={{
        display: "grid", gridTemplateColumns: COLS, gap: 12, alignItems: "center",
        padding: "12px 16px", borderBottom: "1px solid var(--line-soft)", cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <Tooltip content={<TokenPreviewCard token={t} />} placement="right" delay={220} maxWidth={262}>
          <div style={{ position: "relative", flexShrink: 0 }}>
            <TokenAvatarFrame
              mint={t.mint_address}
              symbol={t.symbol}
              image={t.image}
              chain={t.chain}
              dex={t.dex}
              migrated={t.migrated_at != null || t.graduated === true}
              size={52}
              progressPercent={t.graduationPercent}
            />
            {t.rank != null && (
              <span className="mono" style={{
                position: "absolute", top: -6, left: -6, zIndex: 3,
                minWidth: 18, padding: "0 4px", borderRadius: 5,
                background: "var(--ink-2)", border: "1px solid var(--line)",
                fontSize: 9.5, lineHeight: "15px", textAlign: "center", color: "var(--paper-2)",
              }}>
                {t.rank}
              </span>
            )}
          </div>
        </Tooltip>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--paper)", whiteSpace: "nowrap" }}>{t.symbol || "—"}</span>
            <span style={{ fontSize: 13, color: "var(--paper-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--paper-3)" }}>
            <span className="mono" style={{ fontSize: 12, color: "var(--buy)" }}>{Number.isFinite(born) ? formatAge(born) : "—"}</span>
            <TokenSocialLinks twitter={t.twitter} telegram={t.telegram} website={t.website} mint={t.mint_address} iconSize={12} stopPropagation />
          </div>
        </div>
      </div>

      <Cell main={fmtMcap(t.marketCap)} sub={change == null ? "—" : fmtPct(change)} subColor={change == null ? undefined : change >= 0 ? "var(--buy)" : "var(--sell)"} />
      <Cell main={fmtUsd(t.liquidity)} />
      <Cell main={fmtUsd(w?.volumeUsd)} />
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span className="mono" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--paper)" }}>{fmtNum(w?.trades)}</span>
        <span className="mono" style={{ fontSize: 12 }}>
          <span style={{ color: "var(--buy)" }}>{fmtNum(w?.buys)}</span>
          <span style={{ color: "var(--paper-4)" }}> / </span>
          <span style={{ color: "var(--sell)" }}>{fmtNum(w?.sells)}</span>
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", justifyContent: "start", gap: "4px 6px" }}>
        <Share label="Top 10" value={t.top10Percent} risk={RISK.top10} icon={Icon.holders(10)} />
        <Share label="Dev" value={t.devPercent} risk={RISK.dev} icon={Icon.dev(10)} />
        <Share label="Snipers" value={t.sniperPercentage} risk={RISK.snipers} icon={Icon.sniper(10)} />
        <Share label="Insiders" value={t.insidersPercent} risk={RISK.insiders} icon={Icon.userLine(10)} />
        <Share label="Bundlers" value={t.bundlePercentage} risk={RISK.bundlers} icon={Icon.bundle(10)} />
        <Tooltip content="Holders">
          <span className="mono" style={chip("var(--paper-2)")}>{Icon.holders(10)} {fmtNum(t.holders)}</span>
        </Tooltip>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <QuickBuy mint={t.mint_address} />
      </div>
    </div>
  );
});

function Cell({ main, sub, subColor }: { main: string; sub?: string; subColor?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span className="mono" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--paper)" }}>{main}</span>
      {sub != null && <span className="mono" style={{ fontSize: 12, color: subColor ?? "var(--paper-4)" }}>{sub}</span>}
    </div>
  );
}

const chip = (color: string): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "2px 6px", borderRadius: 5,
  border: "1px solid var(--line-soft)", background: "var(--ink-1)",
  fontSize: 11, color, whiteSpace: "nowrap",
});

function Share({ label, value, risk, icon }: { label: string; value?: number; risk: number; icon: ReactNode }) {
  const color = value == null ? "var(--paper-4)" : value > risk ? "var(--sell)" : "var(--buy)";
  return (
    <Tooltip content={`${label}${value == null ? ": not measured yet" : ""}`}>
      <span className="mono" style={chip(color)}>{icon} {value == null ? "—" : `${value.toFixed(value < 10 ? 1 : 0)}%`}</span>
    </Tooltip>
  );
}

function QuickBuy({ mint }: { mint: string }) {
  const { run, busy } = useQuickBuy(mint);
  const [amount] = useQuickBuyAmount(QUICK_BUY_SCOPE);
  const [quote] = useBuyQuoteMint();
  if (!(amount > 0)) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => { e.stopPropagation(); void run(amount); }}
      aria-label={`Buy ${amount} ${quote.label}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "6px 10px", borderRadius: 999, border: 0,
        background: "color-mix(in oklch, var(--accent) 22%, var(--ink-2))",
        color: "var(--paper)", fontSize: 12, fontWeight: 600,
        cursor: busy ? "progress" : "pointer", opacity: busy ? 0.6 : 1,
      }}
    >
      {Icon.bolt(11)}
      <QuoteAmount label={quote.label} iconSize={10}>{amount}</QuoteAmount>
    </button>
  );
}
