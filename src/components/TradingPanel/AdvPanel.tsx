"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import {
  useBackend,
  EMPTY_AUTOSELL,
  parseAutosellConfig,
  type AutosellConfig,
  type AutosellPhaseSl,
  type AutosellPhaseTp,
} from "../../api/backend";

type AdvSection = "tp" | "sl" | "extras";

interface Props {
  mint: string;
  symbol: string | null;
  walletIds: string[];
  slipBps: number;
  transactionsFeeLamports: number;
}

export function AdvPanel({
  mint, symbol, walletIds, slipBps, transactionsFeeLamports,
}: Props) {
  const client = useBackend();
  const { pushToast } = useApp();
  const [positions, setPositions] = useState<Array<{ id: string; walletId: string; autosellConfig: unknown }>>([]);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<AdvSection>("tp");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client.listPositions({})
      .then((res) => {
        if (cancelled) return;
        const ours = res.positions.filter((p) => p.mint === mint && p.status === "open");
        setPositions(ours.map((p) => ({ id: p.id, walletId: p.walletId, autosellConfig: p.autosellConfig })));
      })
      .catch(() => { if (!cancelled) setPositions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, mint]);

  const seed = useMemo<AutosellConfig>(() => {
    for (const p of positions) {
      const parsed = parseAutosellConfig(p.autosellConfig);
      if (parsed.enabled) return { ...parsed, slippageBps: slipBps, transactionsFeeLamports };
    }
    if (positions[0]) {
      return { ...parseAutosellConfig(positions[0].autosellConfig), slippageBps: slipBps, transactionsFeeLamports };
    }
    return { ...EMPTY_AUTOSELL, slippageBps: slipBps, transactionsFeeLamports };
  }, [positions, slipBps, transactionsFeeLamports]);

  const [cfg, setCfg] = useState<AutosellConfig>(seed);
  useEffect(() => { setCfg(seed); }, [seed]);

  const noWallet = walletIds.length === 0;
  const heldByWallet = new Map(positions.map((p) => [p.walletId, p]));
  const heldCount = walletIds.filter((id) => heldByWallet.has(id)).length;
  const willPersistAsDefaults = walletIds.length - heldCount;

  function patch(p: Partial<AutosellConfig>) {
    setCfg((c) => ({ ...c, ...p }));
  }

  async function save(next: AutosellConfig) {
    if (noWallet) {
      pushToast({ title: "PICK A WALLET", body: "Select at least one platform wallet first.", tone: "sell" });
      return;
    }
    const merged: AutosellConfig = { ...next, slippageBps: slipBps, transactionsFeeLamports };
    const tasks: Promise<unknown>[] = [];
    for (const wid of walletIds) {
      const pos = heldByWallet.get(wid);
      if (pos) tasks.push(client.setPositionAutosell(pos.id, merged));
      else tasks.push(client.setWalletProfiles(wid, { autosellProfile: merged }));
    }
    setBusy(true);
    try {
      await Promise.all(tasks);
      const label = symbol ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;
      pushToast({
        title: merged.enabled ? "AUTOSELL ARMED" : "AUTOSELL UPDATED",
        body: `${label} · ${heldCount} position${heldCount === 1 ? "" : "s"}${willPersistAsDefaults ? ` + ${willPersistAsDefaults} default${willPersistAsDefaults === 1 ? "" : "s"}` : ""}`,
        tone: "buy",
      });
      const res = await client.listPositions({});
      const ours = res.positions.filter((p) => p.mint === mint && p.status === "open");
      setPositions(ours.map((p) => ({ id: p.id, walletId: p.walletId, autosellConfig: p.autosellConfig })));
    } catch (e) {
      pushToast({ title: "SAVE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
    } finally {
      setBusy(false);
    }
  }

  const statusLine = loading
    ? "Loading…"
    : noWallet
      ? "Select a platform wallet"
      : heldCount > 0
        ? `${heldCount} open position${heldCount === 1 ? "" : "s"}${willPersistAsDefaults ? ` · ${willPersistAsDefaults} wallet default${willPersistAsDefaults === 1 ? "" : "s"}` : ""}`
        : "Saves as wallet default until you buy";

  const tpCount = cfg.tpPhases.length;
  const slCount = cfg.slPhases.length;
  const extrasOn = (cfg.trailingStopLoss ? 1 : 0) + (cfg.migrationSell ? 1 : 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 12px 12px" }}>
      {/* Arm toggle */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "8px 10px",
        background: "var(--ink-0)",
        border: "1px solid var(--line-soft)",
        borderRadius: 6,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--paper)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: cfg.enabled ? "var(--buy)" : "var(--paper-4)",
              flexShrink: 0,
            }} />
            Autosell
          </div>
          <div style={{
            fontSize: 10,
            color: "var(--paper-4)",
            fontFamily: "var(--font-mono)",
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {statusLine}
          </div>
        </div>
        <button
          type="button"
          onClick={() => patch({ enabled: !cfg.enabled })}
          style={{
            padding: "5px 10px",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: cfg.enabled ? "var(--ink-0)" : "var(--paper-3)",
            background: cfg.enabled ? "var(--buy)" : "var(--ink-2)",
            border: `1px solid ${cfg.enabled ? "var(--buy)" : "var(--line-soft)"}`,
            borderRadius: 4,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {cfg.enabled ? "Armed" : "Off"}
        </button>
      </div>

      {/* Section tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 2px" }}>
        <SectionTab label="Take profit" count={tpCount} active={section === "tp"} onClick={() => setSection("tp")} tone="buy" />
        <SectionTab label="Stop loss" count={slCount} active={section === "sl"} onClick={() => setSection("sl")} tone="sell" />
        <SectionTab label="More" count={extrasOn || undefined} active={section === "extras"} onClick={() => setSection("extras")} />
      </div>

      {/* Section body */}
      <div style={{
        background: "var(--ink-0)",
        border: "1px solid var(--line-soft)",
        borderRadius: 6,
        padding: "8px",
        minHeight: 120,
      }}>
        {section === "tp" && (
          <PhaseSection
            empty="No take-profit steps"
            hint="Sell part of the bag at each gain target"
            phases={cfg.tpPhases}
            variant="tp"
            onChange={(p) => patch({ tpPhases: p })}
            onAdd={() => patch({ tpPhases: [...cfg.tpPhases, { gainPct: 50, sellPct: 50 }] })}
          />
        )}
        {section === "sl" && (
          <PhaseSection
            empty="No stop-loss steps"
            hint="Exit on drawdowns below entry"
            phases={cfg.slPhases}
            variant="sl"
            onChange={(p) => patch({ slPhases: p })}
            onAdd={() => patch({ slPhases: [...cfg.slPhases, { lossPct: 30, sellPct: 100 }] })}
          />
        )}
        {section === "extras" && (
          <ExtrasSection cfg={cfg} patch={patch} />
        )}
      </div>

      <button
        type="button"
        disabled={busy || noWallet}
        onClick={() => void save(cfg)}
        style={{
          width: "100%",
          padding: "12px 14px",
          fontSize: 13,
          fontWeight: 700,
          color: "var(--ink-0)",
          background: cfg.enabled ? "var(--buy)" : "var(--ink-2)",
          border: `1px solid ${cfg.enabled ? "var(--buy)" : "var(--line-soft)"}`,
          borderRadius: 6,
          cursor: busy || noWallet ? "not-allowed" : "pointer",
          opacity: busy || noWallet ? 0.5 : 1,
        }}
      >
        {busy ? "Saving…" : cfg.enabled ? "Save & arm" : "Save config"}
      </button>
    </div>
  );
}

function SectionTab({
  label, count, active, onClick, tone,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  tone?: "buy" | "sell";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 0",
        fontSize: 11,
        fontWeight: active ? 700 : 500,
        color: active ? "var(--paper)" : "var(--paper-3)",
        background: "transparent",
        border: 0,
        borderBottom: `2px solid ${active ? (tone === "sell" ? "var(--sell)" : tone === "buy" ? "var(--buy)" : "var(--paper)") : "transparent"}`,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      {label}
      {count != null && count > 0 && (
        <span style={{
          fontSize: 9,
          fontFamily: "var(--font-mono)",
          color: active ? "var(--paper-2)" : "var(--paper-4)",
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

function PhaseSection<T extends AutosellPhaseTp | AutosellPhaseSl>({
  empty, hint, phases, variant, onChange, onAdd,
}: {
  empty: string;
  hint: string;
  phases: T[];
  variant: "tp" | "sl";
  onChange: (next: T[]) => void;
  onAdd: () => void;
}) {
  const triggerKey = variant === "tp" ? "gainPct" : "lossPct";
  const triggerPrefix = variant === "tp" ? "+" : "−";
  const tone = variant === "tp" ? "var(--buy)" : "var(--sell)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 10, color: "var(--paper-4)", lineHeight: 1.4 }}>{hint}</div>
      {phases.length === 0 ? (
        <div style={{
          padding: "14px 8px",
          textAlign: "center",
          fontSize: 11,
          color: "var(--paper-4)",
          border: "1px dashed var(--line-soft)",
          borderRadius: 4,
        }}>
          {empty}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {phases.map((phase, i) => {
            const trigger = phase[triggerKey as keyof T] as number;
            const sell = phase.sellPct;
            return (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "16px 1fr auto 1fr 22px",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 6px",
                  background: "var(--ink-1)",
                  borderRadius: 4,
                  border: "1px solid var(--line-soft)",
                }}
              >
                <span style={{ fontSize: 9, color: "var(--paper-4)", fontFamily: "var(--font-mono)" }}>{i + 1}</span>
                <MiniField
                  prefix={triggerPrefix}
                  suffix="%"
                  value={trigger}
                  tone={tone}
                  onChange={(n) => {
                    const next = phases.slice();
                    next[i] = { ...phase, [triggerKey]: n } as T;
                    onChange(next);
                  }}
                />
                <span style={{ fontSize: 9, color: "var(--paper-4)", textAlign: "center" }}>sell</span>
                <MiniField
                  suffix="%"
                  value={sell}
                  onChange={(n) => {
                    const next = phases.slice();
                    next[i] = { ...phase, sellPct: n } as T;
                    onChange(next);
                  }}
                />
                <button
                  type="button"
                  aria-label="Remove step"
                  onClick={() => onChange(phases.filter((_, j) => j !== i))}
                  style={removeBtnStyle}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
      <button type="button" onClick={onAdd} style={addBtnStyle}>
        + Add step
      </button>
    </div>
  );
}

function ExtrasSection({
  cfg, patch,
}: {
  cfg: AutosellConfig;
  patch: (p: Partial<AutosellConfig>) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <ExtraRow
        label="Trailing stop"
        hint="Sell if price drops from the high"
        on={cfg.trailingStopLoss}
        onToggle={() => patch({ trailingStopLoss: !cfg.trailingStopLoss })}
      >
        {cfg.trailingStopLoss && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
            <MiniLabeled label="Trail" suffix="%" value={cfg.trailingStopLossPct} onChange={(n) => patch({ trailingStopLossPct: n })} />
            <MiniLabeled label="Sell" suffix="%" value={cfg.trailingStopLossSellPct} onChange={(n) => patch({ trailingStopLossSellPct: n })} />
          </div>
        )}
      </ExtraRow>
      <ExtraRow
        label="Migration dump"
        hint="Sell when the token migrates"
        on={cfg.migrationSell}
        onToggle={() => patch({ migrationSell: !cfg.migrationSell })}
      >
        {cfg.migrationSell && (
          <div style={{ marginTop: 6 }}>
            <MiniLabeled label="Sell size" suffix="%" value={cfg.migrationSellPct} onChange={(n) => patch({ migrationSellPct: n })} />
          </div>
        )}
      </ExtraRow>
    </div>
  );
}

function ExtraRow({
  label, hint, on, onToggle, children,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div style={{
      padding: "8px",
      background: "var(--ink-1)",
      border: "1px solid var(--line-soft)",
      borderRadius: 4,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--paper)" }}>{label}</div>
          <div style={{ fontSize: 10, color: "var(--paper-4)", marginTop: 1 }}>{hint}</div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={on}
          style={{
            width: 34,
            height: 20,
            borderRadius: 999,
            border: `1px solid ${on ? "var(--accent)" : "var(--line-soft)"}`,
            background: on ? "var(--accent)" : "var(--ink-2)",
            cursor: "pointer",
            position: "relative",
            flexShrink: 0,
            padding: 0,
          }}
        >
          <span style={{
            position: "absolute",
            top: 2,
            left: on ? 16 : 2,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: on ? "var(--ink-0)" : "var(--paper-4)",
            transition: "left 120ms",
          }} />
        </button>
      </div>
      {children}
    </div>
  );
}

function MiniField({
  prefix, suffix, value, tone, onChange,
}: {
  prefix?: string;
  suffix?: string;
  value: number;
  tone?: string;
  onChange: (n: number) => void;
}) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 2, minWidth: 0 }}>
      {prefix && <span style={{ fontSize: 10, color: tone ?? "var(--paper-4)", fontFamily: "var(--font-mono)" }}>{prefix}</span>}
      <input
        type="text"
        inputMode="decimal"
        value={String(value)}
        onChange={(e) => {
          const n = parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
          if (Number.isFinite(n)) onChange(n);
        }}
        style={{
          ...miniInputStyle,
          color: tone ?? "var(--paper)",
          width: "100%",
        }}
      />
      {suffix && <span style={{ fontSize: 9, color: "var(--paper-4)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{suffix}</span>}
    </div>
  );
}

function MiniLabeled({
  label, suffix, value, onChange,
}: {
  label: string;
  suffix?: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 9, color: "var(--paper-4)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      <MiniField suffix={suffix} value={value} onChange={onChange} />
    </div>
  );
}

const miniInputStyle: React.CSSProperties = {
  padding: "3px 5px",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  background: "var(--ink-0)",
  border: "1px solid var(--line-soft)",
  borderRadius: 3,
  outline: "none",
  minWidth: 0,
};

const addBtnStyle: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: 10,
  fontFamily: "var(--font-mono)",
  color: "var(--paper-3)",
  background: "transparent",
  border: "1px dashed var(--line-soft)",
  borderRadius: 4,
  cursor: "pointer",
  textAlign: "center",
};

const removeBtnStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 14,
  lineHeight: 1,
  color: "var(--paper-4)",
  background: "transparent",
  border: 0,
  borderRadius: 3,
  cursor: "pointer",
  padding: 0,
};
