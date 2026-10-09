"use client";
import React, { useEffect, useMemo, useState } from "react";
import { Icon, Modal, PlatformLogo, SolSymbol, Tooltip, Btn, ModalHeader } from "../atoms";
import { platforms } from "../PlatformFilter";
import {
  COLUMN_META,
  countActive,
  useFilters,
  type ColumnFilters,
  type ColumnKey,
  type Range,
} from "../../contexts/FiltersContext";

type SubTab = "protocols" | "audit" | "metrics" | "socials";

const SUB_TABS: Array<{ id: SubTab; label: string }> = [
  { id: "protocols", label: "Protocols" },
  { id: "audit",     label: "Audit" },
  { id: "metrics",   label: "$ Metrics" },
  { id: "socials",   label: "Socials" },
];

interface Props {
  column: ColumnKey;
}

export function ColumnConfig({ column }: Props) {
  const [open, setOpen] = useState(false);
  const { get } = useFilters();
  const active = countActive(get(column));

  return (
    <>
      <Tooltip content={`Filter ${COLUMN_META[column].label}`}>
      <button
        onClick={() => setOpen(true)}
        aria-label={`Filter ${COLUMN_META[column].label}`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 8px", height: 26,
          color: active > 0 ? "var(--accent)" : "var(--paper-3)",
          background: active > 0 ? "var(--accent-w)" : "transparent",
          border: `1px solid ${active > 0 ? "var(--accent)" : "var(--line-soft)"}`,
          borderRadius: "var(--r-2)",
          fontSize: "var(--t-10)", fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em", textTransform: "uppercase",
          cursor: "pointer",
          transition: "color 120ms, background 120ms, border-color 120ms",
        }}
      >
        {Icon.filter(12)}
        {active > 0 && <CountPill n={active} tone="solid" />}
      </button>
      </Tooltip>

      <FiltersModal
        open={open}
        onClose={() => setOpen(false)}
        initialColumn={column}
      />
    </>
  );
}

// ═══ main modal ══════════════════════════════════════════════════════════════

function FiltersModal({
  open,
  onClose,
  initialColumn,
}: {
  open: boolean;
  onClose: () => void;
  initialColumn: ColumnKey;
}) {
  const { get, update, reset, filters } = useFilters();
  const [activeCol, setActiveCol] = useState<ColumnKey>(initialColumn);
  const [subTab, setSubTab] = useState<SubTab>("protocols");

  useEffect(() => { if (open) setActiveCol(initialColumn); }, [open, initialColumn]);

  const f = get(activeCol);
  const patch = (p: Partial<ColumnFilters>) => update(activeCol, p);
  const totalActive = useMemo(
    () => (["trending", "deploy", "migrating", "migration"] as ColumnKey[])
      .reduce((sum, k) => sum + countActive(filters[k]), 0),
    [filters],
  );

  return (
    <Modal open={open} onClose={onClose} width={560} align="top">
      {/* ── header ───────────────────────────────────────────────── */}
      <ModalHeader
        title="Filters"
        eyebrow={totalActive > 0 ? `${totalActive} active` : "none active"}
        onClose={onClose}
        extra={
          <IconBtn title="Reset this column" onClick={() => reset(activeCol)}>
            {Icon.refresh(13)}
          </IconBtn>
        }
      />

      {/* ── column tabs (segmented) ──────────────────────────────── */}
      <ColumnSegmented active={activeCol} onChange={setActiveCol} />

      {/* ── body ─────────────────────────────────────────────────── */}
      <div style={{
        padding: "16px 20px 0",
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        <KeywordRow
          search={f.search}
          exclude={f.exclude}
          onSearch={(v) => patch({ search: v })}
          onExclude={(v) => patch({ exclude: v })}
        />

        <SubTabsRow active={subTab} onChange={setSubTab} filters={f} />
      </div>

      {/* ── panel (scrollable) ───────────────────────────────────── */}
      <div style={{
        padding: "14px 20px 20px",
        maxHeight: "min(52vh, 440px)",
        overflow: "auto",
      }}>
        <PanelSwitcher subTab={subTab} filters={f} patch={patch} />
      </div>

      {/* ── footer ───────────────────────────────────────────────── */}
      <div style={{
        padding: "12px 20px",
        borderTop: "1px solid var(--line-soft)",
        background: "var(--ink-0)",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      }}>
        <SpamPill
          on={f.spam}
          onChange={(v) => patch({ spam: v })}
        />
        <Btn tone="solid" size="sm" onClick={onClose}>Done</Btn>
      </div>
    </Modal>
  );
}

function PanelSwitcher({
  subTab, filters, patch,
}: {
  subTab: SubTab;
  filters: ColumnFilters;
  patch: (p: Partial<ColumnFilters>) => void;
}) {
  return (
    <div key={subTab} style={{ animation: "slideIn 180ms ease-out" }}>
      {subTab === "protocols" && <ProtocolsPanel filters={filters} patch={patch} />}
      {subTab === "audit"     && <AuditPanel     filters={filters} patch={patch} />}
      {subTab === "metrics"   && <MetricsPanel   filters={filters} patch={patch} />}
      {subTab === "socials"   && <SocialsPanel   filters={filters} patch={patch} />}
    </div>
  );
}

// ═══ header bits ═════════════════════════════════════════════════════════════

function IconBtn({
  title, onClick, children,
}: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip content={title}>
    <button
      onClick={onClick}
      aria-label={title}
      style={{
        width: 28, height: 28,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        color: "var(--paper-3)",
        background: "transparent",
        border: "1px solid transparent",
        borderRadius: "var(--r-2)",
        cursor: "pointer",
        transition: "color 120ms, background 120ms, border-color 120ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--paper)";
        e.currentTarget.style.background = "var(--ink-2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--paper-3)";
        e.currentTarget.style.background = "transparent";
      }}
    >{children}</button>
    </Tooltip>
  );
}

// ═══ column segmented control ═══════════════════════════════════════════════

function ColumnSegmented({
  active, onChange,
}: { active: ColumnKey; onChange: (c: ColumnKey) => void }) {
  const { get } = useFilters();
  const keys: ColumnKey[] = ["trending", "deploy", "migrating", "migration"];
  return (
    <div style={{
      padding: "12px 20px",
      borderBottom: "1px solid var(--line-soft)",
      background: "var(--ink-1)",
    }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 0,
        padding: 3,
        background: "var(--ink-0)",
        border: "1px solid var(--line-soft)",
        borderRadius: "var(--r-3)",
        position: "relative",
      }}>
        {keys.map((key) => {
          const isActive = key === active;
          const n = countActive(get(key));
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              style={{
                position: "relative",
                padding: "8px 10px",
                background: isActive ? "var(--ink-2)" : "transparent",
                color: isActive ? "var(--paper)" : "var(--paper-3)",
                border: "none",
                borderRadius: "var(--r-2)",
                fontSize: "var(--t-13)", fontFamily: "var(--font-ui)",
                fontWeight: isActive ? 500 : 400,
                cursor: "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                transition: "color 140ms, background 140ms",
                boxShadow: isActive ? "0 1px 0 oklch(0 0 0 / 0.35), inset 0 0 0 1px var(--line-soft)" : "none",
              }}
            >
              {COLUMN_META[key].label}
              {n > 0 && <CountPill n={n} tone={isActive ? "solid" : "ghost"} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CountPill({ n, tone = "solid" }: { n: number; tone?: "solid" | "ghost" }) {
  const solid = tone === "solid";
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minWidth: 16, height: 16, padding: "0 5px",
        fontSize: 10, fontWeight: 500,
        color: solid ? "var(--ink-0)" : "var(--accent)",
        background: solid ? "var(--accent)" : "var(--accent-w)",
        border: solid ? "none" : `1px solid var(--accent)`,
        borderRadius: 8,
        lineHeight: 1,
      }}
    >{n}</span>
  );
}

// ═══ keyword row ═════════════════════════════════════════════════════════════

function KeywordRow({
  search, exclude, onSearch, onExclude,
}: {
  search: string;
  exclude: string;
  onSearch: (v: string) => void;
  onExclude: (v: string) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <KeywordField
        label="Search"
        value={search}
        onChange={onSearch}
        icon={Icon.search(12)}
        accent="var(--accent)"
      />
      <KeywordField
        label="Exclude"
        value={exclude}
        onChange={onExclude}
        icon={Icon.close(12)}
        accent="var(--sell)"
      />
    </div>
  );
}

function KeywordField({
  label, value, onChange, icon, accent,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  icon: React.ReactNode;
  accent: string;
}) {
  const [focused, setFocused] = useState(false);
  const hasValue = value.trim().length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="eyebrow">{label}</span>
      <div style={{
        position: "relative",
        display: "flex", alignItems: "center",
        background: "var(--ink-0)",
        border: `1px solid ${focused || hasValue ? accent : "var(--line-soft)"}`,
        borderRadius: "var(--r-2)",
        transition: "border-color 120ms, box-shadow 120ms",
        boxShadow: focused ? `0 0 0 3px ${accent}22` : "none",
      }}>
        <span style={{
          paddingLeft: 10, display: "inline-flex",
          color: hasValue ? accent : "var(--paper-4)",
          transition: "color 120ms",
        }}>{icon}</span>
        <input
          type="text"
          value={value}
          placeholder="keyword, keyword…"
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            padding: "8px 10px",
            background: "transparent",
            border: "none", outline: "none",
            color: "var(--paper)",
            fontSize: "var(--t-12)", fontFamily: "var(--font-mono)",
            minWidth: 0,
          }}
        />
        {hasValue && (
          <button
            onClick={() => onChange("")}
            aria-label={`Clear ${label.toLowerCase()}`}
            style={{
              padding: "0 8px", display: "inline-flex",
              color: "var(--paper-4)", background: "transparent", border: "none",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--paper)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--paper-4)")}
          >{Icon.close(11)}</button>
        )}
      </div>
    </div>
  );
}

// ═══ sub-tabs ════════════════════════════════════════════════════════════════

function SubTabsRow({
  active, onChange, filters,
}: { active: SubTab; onChange: (t: SubTab) => void; filters: ColumnFilters }) {
  const counts = subTabCounts(filters);
  return (
    <div style={{
      display: "flex", gap: 4,
      paddingBottom: 4,
      borderBottom: "1px solid var(--line-soft)",
    }}>
      {SUB_TABS.map((tab) => {
        const isActive = tab.id === active;
        const n = counts[tab.id];
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              position: "relative",
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 14px",
              background: "transparent",
              border: "none",
              color: isActive ? "var(--paper)" : "var(--paper-3)",
              fontSize: "var(--t-12)", fontFamily: "var(--font-ui)",
              fontWeight: isActive ? 500 : 400,
              cursor: "pointer",
              transition: "color 120ms",
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.color = "var(--paper-2)";
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.color = "var(--paper-3)";
            }}
          >
            {tab.label}
            {n > 0 && <CountPill n={n} tone={isActive ? "solid" : "ghost"} />}
            <span style={{
              position: "absolute",
              left: 10, right: 10, bottom: -5,
              height: 2,
              background: isActive ? "var(--paper)" : "transparent",
              borderRadius: 1,
              transition: "background 140ms",
            }} />
          </button>
        );
      })}
    </div>
  );
}

function subTabCounts(f: ColumnFilters): Record<SubTab, number> {
  const rangeN = (r: Range) => (r.min != null || r.max != null ? 1 : 0);
  return {
    protocols: f.platforms.length !== platforms().length ? 1 : 0,
    audit:
      rangeN(f.bundlePercentage) + rangeN(f.sniperPercentage) +
      rangeN(f.creatorDeploys),
    metrics:
      rangeN(f.marketCap) + rangeN(f.volume24h) + rangeN(f.liquidity) +
      rangeN(f.priceChange) + rangeN(f.tradeCount) + rangeN(f.holders) +
      rangeN(f.ageMinutes),
    socials:
      (f.requireTwitter ? 1 : 0) + (f.requireWebsite ? 1 : 0) + (f.requireTelegram ? 1 : 0),
  };
}

// ═══ panels ══════════════════════════════════════════════════════════════════

function ProtocolsPanel({
  filters, patch,
}: { filters: ColumnFilters; patch: (p: Partial<ColumnFilters>) => void }) {
  const selected = new Set(filters.platforms);
  function toggle(v: string) {
    const next = new Set(selected);
    if (next.has(v)) {
      if (next.size === 1) return;
      next.delete(v);
    } else {
      next.add(v);
    }
    patch({ platforms: platforms().map((p) => p.value).filter((p) => next.has(p)) });
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span className="eyebrow">Launchpads</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--paper-3)" }}>
          {selected.size}/{platforms().length}
        </span>
      </div>
      {platforms().length === 0 && (
        <span className="mono" style={{ fontSize: 11, color: "var(--paper-3)" }}>
          No launchpad filters on this chain.
        </span>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {platforms().map((p) => {
          const isOn = selected.has(p.value);
          return (
            <ProtocolChip
              key={p.value}
              label={p.label}
              value={p.value}
              isOn={isOn}
              onClick={() => toggle(p.value)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ProtocolChip({
  label, value, isOn, onClick,
}: { label: string; value: string; isOn: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-pressed={isOn}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 14px",
        background: isOn ? "var(--accent-w)" : hover ? "var(--ink-2)" : "var(--ink-1)",
        border: `1px solid ${isOn ? "var(--accent)" : "var(--line-soft)"}`,
        color: isOn ? "var(--paper)" : "var(--paper-2)",
        borderRadius: "var(--r-3)",
        fontSize: "var(--t-13)", fontFamily: "var(--font-ui)",
        cursor: "pointer",
        transition: "all 140ms",
        textAlign: "left",
      }}
    >
      <span style={{
        width: 28, height: 28, borderRadius: "var(--r-2)",
        background: "var(--ink-0)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        opacity: isOn ? 1 : 0.72,
        transition: "opacity 140ms",
      }}>
        <PlatformLogo platform={value} size={18} />
      </span>
      <span style={{ flex: 1, fontWeight: isOn ? 500 : 400 }}>{label}</span>
      <Check on={isOn} />
    </button>
  );
}

// ─── Audit panel ───────────────────────────────────────────────────────────

function AuditPanel({
  filters, patch,
}: { filters: ColumnFilters; patch: (p: Partial<ColumnFilters>) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <RangeField label="Bundle"        suffix="%" hint="Supply held by coordinated bundlers"
        r={filters.bundlePercentage}   onChange={(r) => patch({ bundlePercentage: r })} />
      <RangeField label="Sniper"        suffix="%" hint="Supply snagged in the first seconds"
        r={filters.sniperPercentage}   onChange={(r) => patch({ sniperPercentage: r })} />
      <RangeField label="Dev Deploys"               hint="How many tokens this dev has launched"
        r={filters.creatorDeploys}     onChange={(r) => patch({ creatorDeploys: r })} />
    </div>
  );
}

// ─── Metrics panel ─────────────────────────────────────────────────────────

function MetricsPanel({
  filters, patch,
}: { filters: ColumnFilters; patch: (p: Partial<ColumnFilters>) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <RangeField label="Market Cap"        prefix="$"        r={filters.marketCap}       onChange={(r) => patch({ marketCap: r })} />
      <RangeField label="Volume 24h"        suffix={<SolSymbol size={10} />} r={filters.volume24h}       onChange={(r) => patch({ volume24h: r })} />
      <RangeField label="Liquidity"         prefix="$"        r={filters.liquidity}       onChange={(r) => patch({ liquidity: r })} />
      <RangeField label="Price Change"      suffix="%"        r={filters.priceChange}     onChange={(r) => patch({ priceChange: r })} />
      <RangeField label="Trades"                              r={filters.tradeCount}      onChange={(r) => patch({ tradeCount: r })} />
      <RangeField label="Holders"                             r={filters.holders}         onChange={(r) => patch({ holders: r })} />
      <RangeField label="Age"               suffix="min"      r={filters.ageMinutes}      onChange={(r) => patch({ ageMinutes: r })} />
    </div>
  );
}

// ─── Socials panel ─────────────────────────────────────────────────────────

function SocialsPanel({
  filters, patch,
}: { filters: ColumnFilters; patch: (p: Partial<ColumnFilters>) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <span className="eyebrow">Require</span>
        <div style={{ fontSize: 11, color: "var(--paper-3)", marginTop: 4 }}>
          Token must have the selected links set in its metadata.
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <SocialCard
          label="Twitter"
          on={filters.requireTwitter}
          onChange={(v) => patch({ requireTwitter: v })}
          icon={Icon.x(16)}
        />
        <SocialCard
          label="Website"
          on={filters.requireWebsite}
          onChange={(v) => patch({ requireWebsite: v })}
          icon={Icon.website(16)}
        />
        <SocialCard
          label="Telegram"
          on={filters.requireTelegram}
          onChange={(v) => patch({ requireTelegram: v })}
          icon={Icon.telegram(16)}
        />
      </div>
    </div>
  );
}

function SocialCard({
  label, on, onChange, icon,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
  icon: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={() => onChange(!on)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-pressed={on}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        padding: "16px 10px",
        background: on ? "var(--accent-w)" : hover ? "var(--ink-2)" : "var(--ink-1)",
        border: `1px solid ${on ? "var(--accent)" : "var(--line-soft)"}`,
        color: on ? "var(--paper)" : "var(--paper-2)",
        borderRadius: "var(--r-3)",
        fontSize: "var(--t-12)", fontFamily: "var(--font-ui)",
        cursor: "pointer",
        transition: "all 140ms",
      }}
    >
      <span style={{
        width: 32, height: 32, borderRadius: "var(--r-2)",
        background: on ? "var(--accent)" : "var(--ink-0)",
        color: on ? "var(--ink-0)" : "var(--paper-2)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        transition: "all 140ms",
      }}>{icon}</span>
      <span style={{ fontWeight: on ? 500 : 400 }}>{label}</span>
    </button>
  );
}

// ═══ range field ═════════════════════════════════════════════════════════════

function RangeField({
  label, r, onChange, prefix, suffix, hint,
}: {
  label: string;
  r: Range;
  onChange: (r: Range) => void;
  prefix?: string;
  suffix?: React.ReactNode;
  hint?: string;
}) {
  const isSet = r.min != null || r.max != null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{
          fontSize: "var(--t-12)", color: "var(--paper-2)", fontWeight: 500,
        }}>{label}</span>
        {hint && !isSet && (
          <span style={{ fontSize: 10, color: "var(--paper-4)", textAlign: "right" }}>{hint}</span>
        )}
        {isSet && (
          <button
            onClick={() => onChange({})}
            style={{
              fontSize: 10, color: "var(--paper-4)",
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase", letterSpacing: "0.08em",
              background: "transparent", border: "none", cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--paper-2)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--paper-4)")}
          >Clear</button>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "stretch" }}>
        <NumberCell
          value={r.min}
          placeholder="Min"
          prefix={prefix}
          suffix={suffix}
          onChange={(v) => onChange({ ...r, min: v })}
          side="left"
        />
        <div style={{
          width: 22,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: "var(--paper-4)",
          background: "var(--ink-0)",
          borderTop: "1px solid var(--line-soft)",
          borderBottom: "1px solid var(--line-soft)",
          fontSize: 11, fontFamily: "var(--font-mono)",
        }}>—</div>
        <NumberCell
          value={r.max}
          placeholder="Max"
          prefix={prefix}
          suffix={suffix}
          onChange={(v) => onChange({ ...r, max: v })}
          side="right"
        />
      </div>
    </div>
  );
}

function NumberCell({
  value, placeholder, prefix, suffix, onChange, side,
}: {
  value?: number;
  placeholder?: string;
  prefix?: string;
  suffix?: React.ReactNode;
  onChange: (v: number | undefined) => void;
  side: "left" | "right";
}) {
  const [text, setText] = useState<string>(value != null ? String(value) : "");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    setText(value != null ? String(value) : "");
  }, [value]);

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return onChange(undefined);
    const n = Number(trimmed);
    if (Number.isFinite(n)) onChange(n);
  }

  const radius = side === "left"
    ? `var(--r-2) 0 0 var(--r-2)`
    : `0 var(--r-2) var(--r-2) 0`;

  return (
    <div style={{
      flex: 1,
      position: "relative",
      display: "flex", alignItems: "center",
      background: "var(--ink-0)",
      border: `1px solid ${focused ? "var(--accent)" : "var(--line-soft)"}`,
      borderRadius: radius,
      boxShadow: focused ? `inset 0 0 0 1px var(--accent), 0 0 0 3px var(--accent-w)` : "none",
      transition: "border-color 120ms, box-shadow 120ms",
      zIndex: focused ? 1 : 0,
    }}>
      {prefix && (
        <span style={{
          paddingLeft: 10, color: "var(--paper-4)",
          fontSize: "var(--t-12)", fontFamily: "var(--font-mono)",
          userSelect: "none",
        }}>{prefix}</span>
      )}
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => { setFocused(false); commit(e.target.value); }}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        style={{
          flex: 1, minWidth: 0,
          padding: prefix
            ? "8px 6px 8px 4px"
            : suffix ? "8px 2px 8px 10px" : "8px 10px",
          background: "transparent", border: "none", outline: "none",
          color: "var(--paper)",
          fontSize: "var(--t-12)", fontFamily: "var(--font-mono)",
        }}
      />
      {suffix && (
        <span style={{
          paddingRight: 10, color: "var(--paper-4)",
          fontSize: "var(--t-12)", fontFamily: "var(--font-mono)",
          userSelect: "none",
        }}>{suffix}</span>
      )}
    </div>
  );
}

// ═══ footer bits ═════════════════════════════════════════════════════════════

function SpamPill({
  on, onChange,
}: { on: boolean; onChange: (v: boolean) => void }) {
  const tooltip = on
    ? "Dead tokens and same-name duplicates are hidden"
    : "All tokens in the stream are shown";
  return (
    <Tooltip content={tooltip}>
    <button
      onClick={() => onChange(!on)}
      aria-pressed={on}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: "5px 10px 5px 6px",
        background: on ? "var(--accent-w)" : "transparent",
        border: `1px solid ${on ? "var(--accent)" : "var(--line-soft)"}`,
        borderRadius: "var(--r-5)",
        color: on ? "var(--paper)" : "var(--paper-3)",
        fontSize: "var(--t-12)", fontFamily: "var(--font-ui)",
        cursor: "pointer",
        transition: "all 140ms",
      }}
    >
      <Switch on={on} />
      Hide dead tokens
    </button>
    </Tooltip>
  );
}

// ═══ primitives ══════════════════════════════════════════════════════════════

function Check({ on }: { on: boolean }) {
  return (
    <span style={{
      width: 16, height: 16, borderRadius: 3,
      border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
      background: on ? "var(--accent)" : "transparent",
      color: "var(--ink-0)",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
      transition: "all 140ms",
    }}>
      {on && Icon.check(11)}
    </span>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        width: 28, height: 16,
        background: on ? "var(--accent)" : "var(--line)",
        borderRadius: 8,
        transition: "background 140ms",
        flexShrink: 0,
      }}
    >
      <span style={{
        position: "absolute",
        top: 2, left: on ? 14 : 2,
        width: 12, height: 12,
        background: on ? "var(--ink-0)" : "var(--paper)",
        borderRadius: "50%",
        transition: "left 140ms",
        boxShadow: "0 1px 2px oklch(0 0 0 / 0.3)",
      }} />
    </span>
  );
}
