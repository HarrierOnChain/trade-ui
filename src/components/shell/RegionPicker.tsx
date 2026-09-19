"use client";
import React, { useEffect, useRef, useState } from "react";
import { useRegion, type RegionLatency } from "../../contexts/RegionContext";
import { type Region, type RegionId } from "../../lib/regions";
import { Tooltip } from "../atoms";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { viewportMaxWidth } from "../../lib/popover";

export function RegionPicker() {
  const {
    region,
    regions,
    setRegion,
    latencies,
    refreshRegionPings,
  } = useRegion();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const isPhone = useIsPhone();
  const regionalRegions = regions.filter((r) => r.id !== "local");
  const localRegion = regions.find((r) => r.id === "local");

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex", height: "100%" }}>
      <Tooltip
        content={`Backend region · ${region.label}`}
        placement="bottom"
      >
        <button
          ref={anchorRef}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => {
            setOpen((o) => {
              const next = !o;
              if (next) refreshRegionPings();
              return next;
            });
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "0 9px",
            height: "100%",
            background: open ? "var(--ink-2)" : "transparent",
            border: 0,
            color: open ? "var(--paper)" : "var(--paper-3)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
            cursor: "pointer",
            transition: "background 120ms, color 120ms",
          }}
        >
          <RegionFlag id={region.id} size="sm" />
          <span className="eyebrow" style={{ fontSize: 8, color: "var(--paper)" }}>SERVER</span>
          <span className="mono" style={{ fontSize: 11, fontWeight: 500, color: "var(--paper)" }}>
            {region.flag}
          </span>
          <ChevronIcon open={open} />
        </button>
      </Tooltip>
      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            bottom: "100%",
            right: 0,
            marginBottom: 4,
            width: isPhone ? "min(206px, 78vw)" : 206,
            maxWidth: viewportMaxWidth(),
            background: "var(--ink-1)",
            border: "1px solid var(--line-soft)",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            padding: 4,
            maxHeight: "min(330px, calc(100dvh - 54px))",
            overflowY: "auto",
            zIndex: 50,
          }}
        >
          {regionalRegions.map((r) => (
            <RegionRow
              key={r.id}
              r={r}
              active={r.id === region.id}
              latency={latencies[r.id]}
              onPick={(id) => {
                setRegion(id);
                setOpen(false);
              }}
            />
          ))}
          {localRegion && (
            <>
              <div style={{ height: 1, background: "var(--line-soft)", margin: "4px 2px" }} />
              <RegionRow
                r={localRegion}
                active={localRegion.id === region.id}
                latency={latencies[localRegion.id]}
                onPick={(id) => {
                  setRegion(id);
                  setOpen(false);
                }}
              />
            </>
          )}
        </div>
      )}
    </span>
  );
}

function RegionRow({
  r,
  active,
  latency,
  onPick,
}: {
  r: Region;
  active: boolean;
  latency?: RegionLatency;
  onPick: (id: RegionId) => void;
}) {
  return (
    <button
      onClick={() => onPick(r.id)}
      role="option"
      aria-selected={active}
      style={rowStyle(active)}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--ink-2)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <RegionFlag id={r.id} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        {r.label}
      </span>
      <LatencyBadge latency={latency} />
      <RowCheck active={active} />
    </button>
  );
}

function rowStyle(active: boolean): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "22px minmax(0, 1fr) 42px 8px",
    alignItems: "center",
    gap: 8,
    padding: "5px 7px",
    width: "100%",
    minHeight: 28,
    border: 0,
    background: active ? "var(--ink-2)" : "transparent",
    color: active ? "var(--paper)" : "var(--paper-2)",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    letterSpacing: "0.04em",
    cursor: "pointer",
    borderRadius: 4,
    textAlign: "left",
  };
}

function RegionFlag({
  id,
  muted = false,
  size = "md",
}: {
  id: RegionId;
  muted?: boolean;
  size?: "sm" | "md";
}) {
  const width = size === "sm" ? 18 : 22;
  const height = size === "sm" ? 12 : 15;
  return (
    <span
      aria-hidden="true"
      style={{
        width,
        height,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 3,
        overflow: "hidden",
        background: "var(--ink-2)",
        boxShadow: "0 0 0 1px color-mix(in oklch, var(--paper) 12%, transparent)",
        opacity: muted ? 0.55 : 1,
        flexShrink: 0,
      }}
    >
      <FlagSvg id={id} />
    </span>
  );
}

function FlagSvg({ id }: { id: RegionId }) {
  if (id === "cp") return (
    <svg width="100%" height="100%" viewBox="0 0 36 24" aria-hidden="true" style={{ display: "block" }}>
      <rect width="36" height="24" fill="var(--ink-2)" />
      <circle cx="18" cy="12" r="8.5" fill="none" stroke="var(--accent)" strokeWidth="1.4" />
      <ellipse cx="18" cy="12" rx="3.2" ry="8.5" fill="none" stroke="var(--accent)" strokeWidth="1.1" />
      <path d="M9.5 12h17" stroke="var(--accent)" strokeWidth="1.1" />
      <path d="M10.2 8.2h15.6M10.2 15.8h15.6" stroke="var(--accent)" strokeWidth="0.9" opacity="0.85" />
    </svg>
  );
  return (
    <svg width="100%" height="100%" viewBox="0 0 36 24" aria-hidden="true" style={{ display: "block" }}>
      <rect width="36" height="24" fill="var(--ink-2)" />
      <rect x="7" y="6" width="22" height="12" rx="2" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      <path d="M11 10h7M11 14h4M23 14h2" stroke="var(--paper)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function RowCheck({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: active ? "var(--accent)" : "transparent",
        boxShadow: active ? "0 0 7px color-mix(in oklch, var(--accent) 65%, transparent)" : "none",
      }}
    />
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true" style={{ display: "block", color: "var(--paper-4)" }}>
      <path
        d="M2.2 3.6 5 6.4l2.8-2.8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transform: open ? "rotate(180deg)" : "none", transformOrigin: "50% 50%", transition: "transform 120ms" }}
      />
    </svg>
  );
}

function LatencyBadge({ latency }: { latency?: RegionLatency }) {
  let label = "--";
  let color = "var(--paper-4)";

  if (latency?.status === "checking") {
    label = "...";
  } else if (latency?.status === "ok" && latency.ms != null) {
    label = `${latency.ms}ms`;
    color = latency.ms < 120 ? "var(--accent)" : latency.ms < 260 ? "var(--warn)" : "var(--sell)";
  } else if (latency?.status === "error") {
    label = "DOWN";
    color = "var(--sell)";
  }

  return (
    <span style={{
      minWidth: 42,
      textAlign: "right",
      color,
      fontSize: 10,
      letterSpacing: 0,
      fontVariantNumeric: "tabular-nums",
    }}>
      {label}
    </span>
  );
}
