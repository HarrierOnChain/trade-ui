"use client";
import React, { memo, useEffect, useRef, useState } from "react";
import { resolvePresetValue, isValidPresetValue, type Side } from "./presets";

export interface PresetButtonProps {
  value: string;
  onExecute: (amount: string) => void;
  onChange: (next: string) => void;
  isLoading?: boolean;
  variant?: Side;
  isEditMode: boolean;
  isMobile?: boolean;
}

const filterNum = (v: string) => v.replace(/[^0-9.]/g, "");

function PresetButtonInner({
  value, onExecute, onChange,
  isLoading = false,
  variant = "buy",
  isEditMode,
  isMobile = false,
}: PresetButtonProps) {
  const rangeMatch = value.match(/^(\d+\.?\d*)-(\d+\.?\d*)$/);
  const [minVal, setMinVal] = useState(rangeMatch ? rangeMatch[1] : value);
  const [maxVal, setMaxVal] = useState(rangeMatch ? rangeMatch[2] : "");
  const minRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const m = value.match(/^(\d+\.?\d*)-(\d+\.?\d*)$/);
    if (m) { setMinVal(m[1]); setMaxVal(m[2]); }
    else { setMinVal(value); setMaxVal(""); }
  }, [value]);

  useEffect(() => {
    if (isEditMode && minRef.current) minRef.current.focus();
  }, [isEditMode]);

  function commit() {
    const next = maxVal && parseFloat(maxVal) > 0 ? `${minVal}-${maxVal}` : minVal;
    if (isValidPresetValue(next)) onChange(next);
    else {
      const m = value.match(/^(\d+\.?\d*)-(\d+\.?\d*)$/);
      if (m) { setMinVal(m[1]); setMaxVal(m[2]); }
      else { setMinVal(value); setMaxVal(""); }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commit();
    else if (e.key === "Escape") {
      const m = value.match(/^(\d+\.?\d*)-(\d+\.?\d*)$/);
      if (m) { setMinVal(m[1]); setMaxVal(m[2]); }
      else { setMinVal(value); setMaxVal(""); }
    }
  }

  if (isEditMode) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <input
          ref={minRef}
          value={minVal}
          onChange={(e) => setMinVal(filterNum(e.target.value))}
          onKeyDown={onKeyDown}
          onBlur={commit}
          placeholder="min"
          style={{
            width: "100%", height: 18, padding: "0 4px",
            fontSize: 10, fontFamily: "var(--font-mono)",
            textAlign: "center", color: "var(--paper)",
            background: "var(--ink-0)",
            border: `1px solid ${variant === "buy" ? "var(--buy)" : "var(--sell)"}`,
            borderTopLeftRadius: 3, borderTopRightRadius: 3,
            borderBottom: 0,
            outline: "none",
          }}
        />
        <input
          value={maxVal}
          onChange={(e) => setMaxVal(filterNum(e.target.value))}
          onKeyDown={onKeyDown}
          onBlur={commit}
          placeholder="max"
          style={{
            width: "100%", height: 18, padding: "0 4px",
            fontSize: 10, fontFamily: "var(--font-mono)",
            textAlign: "center", color: "var(--paper)",
            background: "var(--ink-0)",
            border: `1px solid ${variant === "buy" ? "var(--buy)" : "var(--sell)"}`,
            borderBottomLeftRadius: 3, borderBottomRightRadius: 3,
            borderTop: 0,
            outline: "none",
          }}
        />
      </div>
    );
  }

  const tone = variant === "buy"
    ? { fg: "var(--buy)", bd: "var(--line-soft)", bgHover: "var(--buy-w)" }
    : { fg: "var(--sell)", bd: "var(--line-soft)", bgHover: "var(--sell-w)" };

  return (
    <button
      onClick={() => onExecute(resolvePresetValue(value))}
      disabled={isLoading}
      style={{
        height: isMobile ? 44 : 28,
        padding: isMobile ? "0 12px" : "0 8px",
        minWidth: 48,
        fontSize: rangeMatch ? 10 : 11,
        fontFamily: "var(--font-mono)",
        color: tone.fg,
        background: "var(--ink-2)",
        border: `1px solid ${tone.bd}`,
        borderRadius: 3,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        gap: 4,
        cursor: isLoading ? "not-allowed" : "pointer",
        transition: "background 120ms, border-color 120ms",
        opacity: isLoading ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (isLoading) return;
        e.currentTarget.style.background = tone.bgHover;
        e.currentTarget.style.borderColor = tone.fg;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--ink-2)";
        e.currentTarget.style.borderColor = tone.bd;
      }}
    >
      {rangeMatch ? `${rangeMatch[1]}-${rangeMatch[2]}` : value}
    </button>
  );
}

export const PresetButton = memo(PresetButtonInner);
