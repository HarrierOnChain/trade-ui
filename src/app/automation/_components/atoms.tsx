"use client";

// Design primitives for the automation surface.
//
// Visual language mirrors the rest of the terminal: warm cream-on-ink
// surfaces, violet accent, serif italic display, Geist UI, JetBrains
// Mono for numbers. Forms are roomy and breathe (label above input,
// generous padding, switch-style toggles, big number steppers,
// segmented controls for picker-style fields).

import React, { useEffect, useRef, useState } from "react";

// ── Data shape vocabulary (unchanged) ────────────────────────────────────
export type RuleKindAll =
  | "SNIPER"
  | "LIMIT"
  | "AUTOSELL"
  | "AUTOBUY";

export interface TpPhase { gainPct: number; sellPct: number }
export interface SlPhase { lossPct: number; sellPct: number }
export interface BuyPhase { mode: "fixed" | "multiplier" | "dynamic"; amount: number }
export interface DipPhase { lossPct: number; buySol: number }
export interface PyramidPhase { gainPct: number; buySol: number }

export const KIND_META: Record<RuleKindAll, { label: string; color: string; tint: string; abbr: string; glyph: string }> = {
  SNIPER:   { label: "sniper",   color: "var(--accent)",  tint: "var(--accent-w)", abbr: "SNR", glyph: "◎" },
  LIMIT:     { label: "limit",     color: "var(--gold)",    tint: "var(--gold-w)",   abbr: "LMT", glyph: "✦" },
  AUTOSELL:  { label: "autosell",  color: "var(--sell)",    tint: "var(--sell-w)",   abbr: "AUT", glyph: "↓" },
  AUTOBUY:   { label: "autobuy",   color: "var(--buy)",     tint: "var(--buy-w)",    abbr: "ABY", glyph: "↑" },
};

/** Lowercase automation product names — shared across /automation, trading ADV, deploy. */
export const AUTO_LABEL = {
  sniper: "sniper",
  limit: "limit",
  autobuy: "autobuy",
  autosell: "autosell",
  volume: "volume",
  clean: "clean",
} as const;

export type AutoLabelKey = keyof typeof AUTO_LABEL;

export function autoAddLabel(key: AutoLabelKey): string {
  return `+ ${AUTO_LABEL[key]}`;
}

export const STATUS_META: Record<string, { label: string; color: string }> = {
  active:    { label: "Active",    color: "var(--buy)" },
  paused:    { label: "Paused",    color: "var(--gold)" },
  filled:    { label: "Filled",    color: "var(--info)" },
  failed:    { label: "Failed",    color: "var(--sell)" },
  cancelled: { label: "Cancelled", color: "var(--paper-4)" },
  expired:   { label: "Expired",   color: "var(--paper-4)" },
  stopped:   { label: "Stopped",   color: "var(--paper-4)" },
  open:      { label: "Open",      color: "var(--buy)" },
  closed:    { label: "Closed",    color: "var(--paper-4)" },
};

// ── Layout: section card ─────────────────────────────────────────────────

export function SectionCard({
  eyebrow, title, hint, right, dense, children,
}: {
  eyebrow?: string;
  title?: React.ReactNode;
  hint?: React.ReactNode;
  right?: React.ReactNode;
  dense?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section style={{
      background: "var(--ink-1)",
      border: "1px solid var(--line-soft)",
      borderRadius: 12,
      padding: dense ? "14px 16px" : "18px 20px",
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      {(eyebrow || title || right) && (
        <header style={{
          display: "flex", alignItems: "flex-end", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            {eyebrow && (
              <span className="eyebrow" style={{ fontSize: 9, color: "var(--paper-3)" }}>
                {eyebrow}
              </span>
            )}
            {title && (
              <h3 className="ser" style={{
                fontStyle: "italic", fontSize: 22, lineHeight: 1.1,
                color: "var(--paper)", letterSpacing: "-0.01em", fontWeight: 400,
                margin: 0,
              }}>{title}</h3>
            )}
            {hint && (
              <p style={{
                fontSize: 11, color: "var(--paper-3)", lineHeight: 1.5,
                maxWidth: 640, margin: 0,
              }}>{hint}</p>
            )}
          </div>
          {right && <div style={{ display: "flex", gap: 6, alignItems: "center" }}>{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

// ── Field group: vertical-stacked label + input ──────────────────────────

export function Field({
  label, hint, error, children, span = 1,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  span?: 1 | 2 | "full";
  children: React.ReactNode;
}) {
  const gridColumn = span === "full" ? "1 / -1" : span === 2 ? "span 2" : "span 1";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, gridColumn }}>
      <label style={{
        fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
        color: error ? "var(--sell)" : "var(--paper-3)", fontWeight: 500,
        fontFamily: "var(--font-mono)",
      }}>{label}</label>
      {children}
      {hint && !error && (
        <span style={{ fontSize: 11, color: "var(--paper-4)", lineHeight: 1.45 }}>{hint}</span>
      )}
      {error && (
        <span style={{ fontSize: 11, color: "var(--sell)" }}>{error}</span>
      )}
    </div>
  );
}

export function FieldGrid({ cols = 2, children }: { cols?: 1 | 2 | 3; children: React.ReactNode }) {
  // Collapse the grid to a single column when its OWN width gets tight — measured
  // off the grid element (ResizeObserver), not window.innerWidth, because these
  // grids live inside modals/panels that are narrower than the viewport. Each
  // declared track needs ~180px to render a label + roomy input without
  // overflowing on a phone. Desktop is byte-identical: the panel is wide enough
  // that the measured width never trips the threshold, so we keep `cols`.
  const ref = useRef<HTMLDivElement>(null);
  const [effCols, setEffCols] = useState<1 | 2 | 3>(cols);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const MIN_TRACK = 180;
    const apply = (w: number) => {
      // Largest column count (≤ requested) whose tracks each clear MIN_TRACK.
      let next: 1 | 2 | 3 = 1;
      for (let c = cols; c >= 1; c--) {
        if (w >= c * MIN_TRACK) { next = c as 1 | 2 | 3; break; }
      }
      setEffCols((prev) => (prev === next ? prev : next));
    };
    apply(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) apply(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [cols]);
  return (
    <div ref={ref} style={{
      display: "grid", gap: 14,
      gridTemplateColumns: `repeat(${effCols}, minmax(0, 1fr))`,
    }}>{children}</div>
  );
}

// ── Inputs ───────────────────────────────────────────────────────────────

const baseInputStyle: React.CSSProperties = {
  background: "var(--ink-0)",
  border: "1px solid var(--line-soft)",
  color: "var(--paper)",
  padding: "9px 12px",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "var(--font-ui)",
  width: "100%",
  outline: "none",
  transition: "border-color 120ms, background 120ms, box-shadow 120ms",
};

export function TextInput({
  value, onChange, placeholder, mono, autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <input
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        ...baseInputStyle,
        fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
        fontSize: mono ? 12 : 13,
      }}
      onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-w)"; }}
      onBlur={(e) => { e.currentTarget.style.borderColor = "var(--line-soft)"; e.currentTarget.style.boxShadow = "none"; }}
    />
  );
}

export function Select<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={{ ...baseInputStyle, cursor: "pointer", appearance: "none",
        backgroundImage: "linear-gradient(45deg, transparent 50%, var(--paper-3) 50%), linear-gradient(135deg, var(--paper-3) 50%, transparent 50%)",
        backgroundPosition: "calc(100% - 16px) 50%, calc(100% - 11px) 50%",
        backgroundSize: "5px 5px, 5px 5px",
        backgroundRepeat: "no-repeat",
        paddingRight: 32,
      }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function NumberInput({
  value, onChange, min, max, step, suffix, prefix, placeholder,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: React.ReactNode;
  prefix?: React.ReactNode;
  placeholder?: string;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "stretch",
      background: "var(--ink-0)",
      border: "1px solid var(--line-soft)",
      borderRadius: 8,
      transition: "border-color 120ms, box-shadow 120ms",
    }}
    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-w)"; }}
    onBlur={(e) => { e.currentTarget.style.borderColor = "var(--line-soft)"; e.currentTarget.style.boxShadow = "none"; }}
    >
      {prefix && (
        <span style={{
          display: "inline-flex", alignItems: "center", padding: "0 10px",
          color: "var(--paper-4)", fontSize: 11, fontFamily: "var(--font-mono)",
          borderRight: "1px solid var(--line-soft)",
        }}>{prefix}</span>
      )}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min} max={max} step={step ?? 1}
        placeholder={placeholder}
        style={{
          background: "transparent", border: "none", outline: "none",
          color: "var(--paper)", fontFamily: "var(--font-mono)",
          fontSize: 13, padding: "9px 12px", flex: 1, minWidth: 0,
          fontVariantNumeric: "tabular-nums",
        }}
      />
      {suffix && (
        <span style={{
          display: "inline-flex", alignItems: "center", padding: "0 12px",
          color: "var(--paper-3)", fontSize: 11, fontFamily: "var(--font-mono)",
          letterSpacing: "0.02em", borderLeft: "1px solid var(--line-soft)",
          background: "color-mix(in oklch, var(--ink-1) 50%, transparent)",
          borderRadius: "0 7px 7px 0",
        }}>{suffix}</span>
      )}
    </div>
  );
}

// ── Toggle (switch) ──────────────────────────────────────────────────────

export function Toggle({
  value, onChange, label, hint,
}: {
  value: boolean;
  onChange: (b: boolean) => void;
  label: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <label style={{
      display: "flex", alignItems: "flex-start", gap: 12,
      padding: "10px 12px",
      border: "1px solid var(--line-soft)", borderRadius: 8,
      background: value ? "color-mix(in oklch, var(--accent) 6%, var(--ink-0))" : "var(--ink-0)",
      cursor: "pointer",
      transition: "background 140ms, border-color 140ms",
      borderColor: value ? "color-mix(in oklch, var(--accent) 35%, var(--line-soft))" : "var(--line-soft)",
    }}>
      <span style={{
        position: "relative", flex: "0 0 auto",
        width: 30, height: 18, borderRadius: 999,
        background: value ? "var(--accent)" : "var(--ink-3)",
        transition: "background 140ms",
        marginTop: 2,
      }}>
        <span style={{
          position: "absolute", top: 2, left: value ? 14 : 2,
          width: 14, height: 14, borderRadius: 999,
          background: "var(--paper)",
          transition: "left 140ms cubic-bezier(0.4, 1, 0.6, 1)",
          boxShadow: "0 1px 2px oklch(0 0 0 / 0.4)",
        }} />
      </span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} style={{ display: "none" }} />
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 12, color: "var(--paper)", fontWeight: 500, lineHeight: 1.3 }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: "var(--paper-4)", lineHeight: 1.4 }}>{hint}</span>}
      </span>
    </label>
  );
}

// ── Segmented control ────────────────────────────────────────────────────

export function Segmented<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; hint?: string }>;
}) {
  return (
    <div role="tablist" style={{
      display: "inline-flex", padding: 3, gap: 2,
      background: "var(--ink-0)", border: "1px solid var(--line-soft)",
      borderRadius: 10,
    }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            onClick={(e) => { e.preventDefault(); onChange(o.value); }}
            style={{
              padding: "7px 14px",
              fontSize: 12, fontWeight: 500,
              fontFamily: "var(--font-ui)",
              borderRadius: 7,
              background: on ? "var(--accent)" : "transparent",
              color: on ? "var(--ink-0)" : "var(--paper-2)",
              border: "none", cursor: "pointer",
              transition: "background 120ms, color 120ms",
              letterSpacing: "-0.005em",
            }}
            title={o.hint}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

// ── Toggle pill (multi-select pills, e.g. regions) ───────────────────────

export function PillToggle({
  on, onClick, children, disabled,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={(e) => { e.preventDefault(); if (!disabled) onClick(); }}
      disabled={disabled}
      style={{
        background: on ? "var(--accent)" : "transparent",
        color: on ? "var(--ink-0)" : "var(--paper-2)",
        border: `1px solid ${on ? "var(--accent)" : "var(--line-soft)"}`,
        borderRadius: 999,
        padding: "6px 14px",
        fontFamily: "var(--font-mono)",
        fontSize: 11, fontWeight: 500,
        letterSpacing: "0.04em", textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "background 120ms, color 120ms, border-color 120ms",
      }}
    >{children}</button>
  );
}

// ── Chip input (addresses) ───────────────────────────────────────────────

export function ChipInput({
  value, onChange, placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function commitDraft(raw: string) {
    const tokens = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (tokens.length === 0) return;
    const next = [...value];
    for (const t of tokens) if (!next.includes(t)) next.push(t);
    onChange(next);
    setDraft("");
  }

  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center",
      padding: "6px 7px",
      border: "1px solid var(--line-soft)", borderRadius: 8,
      background: "var(--ink-0)", minHeight: 40,
    }}>
      {value.map((addr) => (
        <span key={addr} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 4px 4px 10px", background: "var(--ink-2)",
          border: "1px solid var(--line-soft)", borderRadius: 999,
          fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--paper-2)",
        }}>
          {addr.length > 14 ? `${addr.slice(0, 5)}…${addr.slice(-4)}` : addr}
          <button
            onClick={() => onChange(value.filter((a) => a !== addr))}
            style={{
              background: "transparent", border: "none", color: "var(--paper-4)",
              cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1,
              width: 18, height: 18, borderRadius: 999,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
            aria-label="remove"
          >×</button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,\s]/.test(v.slice(-1))) commitDraft(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commitDraft(draft); }
          else if (e.key === "Backspace" && draft === "" && value.length > 0) onChange(value.slice(0, -1));
        }}
        onBlur={() => { if (draft.trim()) commitDraft(draft); }}
        placeholder={value.length === 0 ? placeholder : ""}
        style={{
          flex: 1, minWidth: 140,
          background: "transparent", border: "none", outline: "none",
          color: "var(--paper)", fontFamily: "var(--font-mono)",
          fontSize: 12, padding: "4px 6px",
        }}
      />
    </div>
  );
}

// ── Phase ladder editor ──────────────────────────────────────────────────

export function PhaseLadder<T extends TpPhase | SlPhase | BuyPhase | DipPhase | PyramidPhase>({
  phases, onChange, variant, onAdd, addLabel,
}: {
  phases: T[];
  onChange: (next: T[]) => void;
  variant: "tp" | "sl" | "buy" | "dip" | "pyramid";
  onAdd: () => void;
  addLabel: string;
}) {
  const variantMeta = {
    tp:      { tone: "var(--buy)",   bg: "var(--buy-w)",   triggerWord: "At gain",   actionWord: "Sell" },
    sl:      { tone: "var(--sell)",  bg: "var(--sell-w)",  triggerWord: "At loss",   actionWord: "Sell" },
    buy:     { tone: "var(--accent)",bg: "var(--accent-w)",triggerWord: "Per fire",  actionWord: "Spend" },
    dip:     { tone: "var(--info)",  bg: "oklch(0.75 0.10 230 / 0.10)", triggerWord: "At dip",  actionWord: "Buy" },
    pyramid: { tone: "var(--buy)",   bg: "var(--buy-w)",   triggerWord: "At gain",   actionWord: "Buy" },
  }[variant];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {phases.length === 0 ? (
        <div style={{
          padding: "16px 18px", borderRadius: 10,
          border: "1px dashed var(--line-soft)",
          fontSize: 12, color: "var(--paper-4)",
          fontFamily: "var(--font-ui)", textAlign: "center",
        }}>
          No steps configured.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {phases.map((p, i) => (
            <PhaseRow
              key={i}
              index={i + 1}
              tone={variantMeta.tone}
              bg={variantMeta.bg}
              onRemove={() => onChange(phases.filter((_, j) => j !== i))}
            >
              {variant === "tp" && (
                <PhaseInline
                  triggerLabel="At +"
                  triggerValue={(p as TpPhase).gainPct}
                  triggerOnChange={(n) => onChange(updateAt(phases, i, { gainPct: n } as unknown as Partial<T>))}
                  triggerSuffix="% gain"
                  actionLabel="Sell"
                  actionValue={(p as TpPhase).sellPct}
                  actionOnChange={(n) => onChange(updateAt(phases, i, { sellPct: n } as unknown as Partial<T>))}
                  actionMax={100}
                  actionSuffix="% of bag"
                />
              )}
              {variant === "sl" && (
                <PhaseInline
                  triggerLabel="At −"
                  triggerValue={(p as SlPhase).lossPct}
                  triggerOnChange={(n) => onChange(updateAt(phases, i, { lossPct: n } as unknown as Partial<T>))}
                  triggerSuffix="% loss"
                  actionLabel="Sell"
                  actionValue={(p as SlPhase).sellPct}
                  actionOnChange={(n) => onChange(updateAt(phases, i, { sellPct: n } as unknown as Partial<T>))}
                  actionMax={100}
                  actionSuffix="% of bag"
                />
              )}
              {variant === "buy" && (
                <PhaseInline
                  triggerLabel="Spend"
                  triggerValue={(p as BuyPhase).amount}
                  triggerOnChange={(n) => onChange(updateAt(phases, i, { amount: n } as unknown as Partial<T>))}
                  triggerStep={0.01}
                  triggerSuffix="SOL"
                />
              )}
              {variant === "dip" && (
                <PhaseInline
                  triggerLabel="At −"
                  triggerValue={(p as DipPhase).lossPct}
                  triggerOnChange={(n) => onChange(updateAt(phases, i, { lossPct: n } as unknown as Partial<T>))}
                  triggerSuffix="% drop"
                  actionLabel="Buy"
                  actionValue={(p as DipPhase).buySol}
                  actionOnChange={(n) => onChange(updateAt(phases, i, { buySol: n } as unknown as Partial<T>))}
                  actionStep={0.01}
                  actionSuffix="SOL"
                />
              )}
              {variant === "pyramid" && (
                <PhaseInline
                  triggerLabel="At +"
                  triggerValue={(p as PyramidPhase).gainPct}
                  triggerOnChange={(n) => onChange(updateAt(phases, i, { gainPct: n } as unknown as Partial<T>))}
                  triggerSuffix="% gain"
                  actionLabel="Buy"
                  actionValue={(p as PyramidPhase).buySol}
                  actionOnChange={(n) => onChange(updateAt(phases, i, { buySol: n } as unknown as Partial<T>))}
                  actionStep={0.01}
                  actionSuffix="SOL"
                />
              )}
            </PhaseRow>
          ))}
        </div>
      )}
      <button
        onClick={(e) => { e.preventDefault(); onAdd(); }}
        style={{
          alignSelf: "flex-start",
          padding: "8px 14px",
          background: "transparent",
          color: variantMeta.tone,
          border: `1px dashed ${variantMeta.tone}`,
          borderRadius: 8,
          fontSize: 11, fontFamily: "var(--font-mono)",
          letterSpacing: "0.04em", textTransform: "uppercase",
          fontWeight: 500, cursor: "pointer",
          transition: "background 120ms",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = variantMeta.bg; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >+ {addLabel}</button>
    </div>
  );
}

function PhaseRow({
  index, tone, bg, onRemove, children,
}: {
  index: number;
  tone: string;
  bg: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 10px 8px 8px",
      background: "var(--ink-0)",
      border: "1px solid var(--line-soft)",
      borderRadius: 10,
    }}>
      <span style={{
        flexShrink: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 24, height: 24, borderRadius: 6,
        background: bg, color: tone,
        fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
      }}>{index}</span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      <button
        onClick={onRemove}
        aria-label="remove step"
        style={{
          flexShrink: 0,
          background: "transparent", border: "1px solid var(--line-soft)",
          borderRadius: 6, color: "var(--paper-4)",
          width: 26, height: 26,
          cursor: "pointer", fontSize: 14, lineHeight: 1,
          transition: "color 120ms, border-color 120ms, background 120ms",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--sell)"; e.currentTarget.style.borderColor = "var(--sell)"; e.currentTarget.style.background = "var(--sell-w)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--paper-4)"; e.currentTarget.style.borderColor = "var(--line-soft)"; e.currentTarget.style.background = "transparent"; }}
      >×</button>
    </div>
  );
}

function PhaseInline({
  triggerLabel, triggerValue, triggerOnChange, triggerSuffix, triggerStep,
  actionLabel, actionValue, actionOnChange, actionSuffix, actionMax, actionStep,
}: {
  triggerLabel: string;
  triggerValue: number;
  triggerOnChange: (n: number) => void;
  triggerSuffix?: string;
  triggerStep?: number;
  actionLabel?: string;
  actionValue?: number;
  actionOnChange?: (n: number) => void;
  actionSuffix?: string;
  actionMax?: number;
  actionStep?: number;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <PhaseField label={triggerLabel} value={triggerValue} onChange={triggerOnChange} suffix={triggerSuffix} step={triggerStep ?? 1} />
      {actionLabel && actionOnChange && actionValue !== undefined && (
        <>
          <span style={{
            color: "var(--paper-4)", fontSize: 10, fontFamily: "var(--font-mono)",
            letterSpacing: "0.06em", textTransform: "uppercase",
          }}>→</span>
          <PhaseField label={actionLabel} value={actionValue} onChange={actionOnChange} suffix={actionSuffix} max={actionMax} step={actionStep ?? 1} />
        </>
      )}
    </div>
  );
}

function PhaseField({
  label, value, onChange, suffix, max, step,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
  max?: number;
  step: number;
}) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 0,
      border: "1px solid var(--line-soft)", borderRadius: 7,
      background: "color-mix(in oklch, var(--ink-1) 60%, transparent)",
    }}>
      <span style={{
        padding: "5px 9px", fontSize: 10, color: "var(--paper-4)",
        fontFamily: "var(--font-mono)", letterSpacing: "0.04em",
        textTransform: "uppercase", borderRight: "1px solid var(--line-soft)",
      }}>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        min={0} max={max} step={step}
        style={{
          background: "transparent", border: "none", outline: "none",
          color: "var(--paper)", fontFamily: "var(--font-mono)",
          fontSize: 12, padding: "5px 6px", width: 64,
          fontVariantNumeric: "tabular-nums", textAlign: "right",
        }}
      />
      {suffix && (
        <span style={{
          padding: "5px 9px", fontSize: 10, color: "var(--paper-3)",
          fontFamily: "var(--font-mono)", letterSpacing: "0.02em",
          borderLeft: "1px solid var(--line-soft)",
        }}>{suffix}</span>
      )}
    </div>
  );
}

function updateAt<T>(arr: T[], idx: number, patch: Partial<T>): T[] {
  return arr.map((v, i) => (i === idx ? { ...v, ...patch } : v));
}

// ── Visual chips & badges ────────────────────────────────────────────────

export function KindChip({ kind, size = "sm" }: { kind: RuleKindAll; size?: "xs" | "sm" | "md" }) {
  const m = KIND_META[kind];
  const fs = size === "xs" ? 9 : size === "md" ? 11 : 10;
  const py = size === "xs" ? 2 : size === "md" ? 4 : 3;
  const px = size === "xs" ? 7 : size === "md" ? 11 : 9;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: `${py}px ${px}px`, borderRadius: 999,
      background: m.tint, color: m.color,
      fontSize: fs, fontWeight: 600, letterSpacing: "0.04em",
      border: `1px solid color-mix(in oklch, ${m.color} 50%, transparent)`,
      lineHeight: 1.3,
      fontFamily: "var(--font-mono)", textTransform: "uppercase",
    }}>
      <span aria-hidden style={{ fontSize: fs + 1, lineHeight: 1 }}>{m.glyph}</span>
      {m.label}
    </span>
  );
}

export function StatusBadge({ status, dim }: { status: string; dim?: boolean }) {
  const m = STATUS_META[status] ?? { label: status, color: "var(--paper-3)" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 10px", borderRadius: 999,
      background: dim ? "transparent" : "var(--ink-2)",
      color: m.color, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase",
      fontFamily: "var(--font-mono)", fontWeight: 600,
      border: dim ? `1px solid color-mix(in oklch, ${m.color} 35%, transparent)` : "1px solid transparent",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: 999, background: m.color,
        boxShadow: status === "active" || status === "open" ? `0 0 8px ${m.color}` : undefined,
        animation: status === "active" || status === "open" ? "pulseDot 2s ease-in-out infinite" : undefined,
      }} />
      {m.label}
    </span>
  );
}

// ── KPI tile ─────────────────────────────────────────────────────────────

export function KpiTile({
  label, value, sub, tone, glyph,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "accent" | "buy" | "sell" | "gold" | "neutral";
  glyph?: React.ReactNode;
}) {
  const color =
    tone === "accent" ? "var(--accent)" :
    tone === "buy"    ? "var(--buy)" :
    tone === "sell"   ? "var(--sell)" :
    tone === "gold"   ? "var(--gold)" :
    "var(--paper)";
  return (
    <div style={{
      flex: 1, minWidth: 0,
      padding: "14px 16px",
      background: "var(--ink-1)",
      border: "1px solid var(--line-soft)",
      borderRadius: 12,
      display: "flex", flexDirection: "column", gap: 6,
      position: "relative", overflow: "hidden",
    }}>
      {glyph && (
        <span aria-hidden style={{
          position: "absolute", top: -8, right: -6,
          fontSize: 72, color, opacity: 0.06,
          fontFamily: "var(--font-dis)", fontStyle: "italic",
          lineHeight: 1, pointerEvents: "none",
        }}>{glyph}</span>
      )}
      <span className="eyebrow" style={{ fontSize: 9 }}>{label}</span>
      <span className="mono" style={{
        fontSize: 22, fontWeight: 500, color,
        letterSpacing: "-0.01em", lineHeight: 1.1,
      }}>{value}</span>
      {sub && (
        <span style={{
          fontSize: 11, color: "var(--paper-4)",
          fontFamily: "var(--font-mono)",
        }}>{sub}</span>
      )}
    </div>
  );
}

// ── Card row (list items in tab content) ────────────────────────────────

export function Tile({
  children, accent, onClick,
}: {
  children: React.ReactNode;
  accent?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        background: "var(--ink-1)",
        border: "1px solid var(--line-soft)",
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex", flexDirection: "column", gap: 10,
        cursor: onClick ? "pointer" : "default",
        transition: "border-color 140ms, background 140ms",
      }}
      onMouseEnter={onClick ? (e) => { e.currentTarget.style.borderColor = "var(--line)"; } : undefined}
      onMouseLeave={onClick ? (e) => { e.currentTarget.style.borderColor = "var(--line-soft)"; } : undefined}
    >
      {accent && (
        <span style={{
          position: "absolute", inset: 0, right: "auto",
          width: 3, background: accent,
          borderRadius: "12px 0 0 12px",
          pointerEvents: "none",
        }} />
      )}
      {children}
    </div>
  );
}

// ── Small text helpers ───────────────────────────────────────────────────

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

export function shortAddr(addr: string, head = 5, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

// ── Compat shims (legacy names still used inline) ───────────────────────

export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return <SectionCard eyebrow={title} right={right} dense>{children}</SectionCard>;
}

export function Card({ children, padding = 14, style }: { children: React.ReactNode; padding?: number; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: "var(--ink-1)", border: "1px solid var(--line-soft)", borderRadius: 10,
      padding, ...style,
    }}>{children}</div>
  );
}
