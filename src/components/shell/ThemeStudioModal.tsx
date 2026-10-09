"use client";
import React, { useRef, useState } from "react";
import { Modal, Icon, Tooltip, ModalHeader } from "../atoms";
import { useApp } from "../../contexts/AppContext";
import { useClientNav } from "./ClientPages";
import { useAppZoom } from "../../contexts/AppZoomContext";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";
import {
  THEME_PRESETS,
  themeSwatch,
  getThemePreset,
  useThemePreset,
  usePrimaryColor,
  type ThemePreset,
} from "../../hooks/useThemeMode";
import {
  FONT_PRESETS,
  getFontPreset,
  useThemeFont,
  useThemeCustomFont,
} from "../../hooks/useThemeFont";

/* ───────────── page-template editor (kept from the old Customize panel) ───────────── */

interface PageDef {
  id: string;
  label: string;
  template: string;
  description: string;
  editPath: string;
}

const CUSTOMIZE_PAGES: PageDef[] = [
  { id: "monitor", label: "Monitor", template: "Default 3-column", description: "Live deploy, migration and mayhem feeds.", editPath: "/monitor?edit=1" },
];

/* ───────────── modal ───────────── */

export function ThemeStudioModal() {
  const { themeStudioOpen, closeThemeStudio } = useApp();
  const isMobile = useIsMobile();
  return (
    <Modal
      open={themeStudioOpen}
      onClose={closeThemeStudio}
      width={520}
      align="center"
      mobileVariant={isMobile ? "sheet" : "center"}
    >
      <ThemeStudioBody onClose={closeThemeStudio} />
    </Modal>
  );
}

function ThemeStudioBody({ onClose }: { onClose: () => void }) {
  const [presetId, setPresetId] = useThemePreset();
  const [primary, setPrimary] = usePrimaryColor();
  const [fontId, setFontId] = useThemeFont();
  const [fontUrl, setFontUrl] = useThemeCustomFont();
  const { zoom, minZoom, maxZoom, mode, enableAuto, zoomIn, zoomOut, setZoom } = useAppZoom();
  const { navigate } = useClientNav();
  const [showExamples, setShowExamples] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const selectPreset = (p: ThemePreset) => {
    setPresetId(p.id);
    if (p.id !== "custom") setPrimary(p.accent);
  };

  const onPrimaryChange = (hex: string) => {
    setPrimary(hex);
    setPresetId("custom");
  };

  const exportTheme = () => {
    const data = { v: 1, preset: presetId, primary, font: fontId, fontUrl, zoom, zoomMode: mode };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "raze-theme.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importTheme = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(String(reader.result || "{}"));
        if (typeof d.preset === "string") setPresetId(d.preset);
        if (typeof d.primary === "string") setPrimary(d.primary);
        if (typeof d.font === "string") setFontId(d.font);
        if (typeof d.fontUrl === "string") setFontUrl(d.fontUrl);
        if (d.zoomMode === "auto") enableAuto();
        else if (typeof d.zoom === "number") setZoom(d.zoom);
      } catch {
        /* ignore malformed theme file */
      }
    };
    reader.readAsText(file);
  };

  const pct = Math.round(zoom * 100);

  return (
    <>
      <ModalHeader title="Customize Theme" icon={Icon.palette(16)} onClose={onClose} />

      {/* body */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", background: "var(--ink-1)" }}>
        {/* preset grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
        }}>
          {THEME_PRESETS.map((p) => (
            <ThemeCard
              key={p.id}
              preset={p}
              active={p.id === presetId}
              // The Custom card always previews the live primary colour.
              accentOverride={p.id === "custom" ? primary : undefined}
              onClick={() => selectPreset(p)}
            />
          ))}
        </div>

        {/* primary color */}
        <FieldLabel>Primary Color</FieldLabel>
        <PrimaryColorField value={primary} onChange={onPrimaryChange} onReset={() => selectPreset(getThemePreset("dark"))} />

        {/* interface zoom */}
        <FieldLabel>Interface Zoom</FieldLabel>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--ink-0)", border: "1px solid var(--line-soft)",
          borderRadius: 8, padding: "8px 10px",
        }}>
          <ZoomBtn label="−" disabled={zoom <= minZoom} onClick={zoomOut} />
          <span className="mono" style={{ minWidth: 52, textAlign: "center", fontSize: 12, color: "var(--paper)" }}>{pct}%</span>
          <ZoomBtn label="+" disabled={zoom >= maxZoom} onClick={zoomIn} />
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={enableAuto}
            aria-pressed={mode === "auto"}
            style={{
              ...resetPillStyle,
              background: mode === "auto" ? "var(--accent)" : "var(--ink-2)",
              borderColor: mode === "auto" ? "var(--accent)" : "var(--line-soft)",
              color: mode === "auto" ? "var(--ink-0)" : "var(--paper-2)",
              fontWeight: 600,
            }}
          >
            Auto
          </button>
        </div>
        <span style={{ fontSize: 11, color: "var(--paper-4)", display: "block", marginTop: 6 }}>
          {mode === "auto"
            ? `Auto-fitted to your screen (${pct}%). Use − / + to set it manually.`
            : "Manual zoom. Tap Auto to fit the UI to your screen size."}
        </span>

        {/* font family */}
        <FieldLabel>Font</FieldLabel>
        <select
          value={fontId}
          onChange={(e) => setFontId(e.target.value)}
          style={{ ...inputStyle, fontFamily: getFontPreset(fontId).stack, cursor: "pointer" }}
        >
          {FONT_PRESETS.map((p) => (
            <option key={p.id} value={p.id} style={{ fontFamily: p.stack }}>{p.label}</option>
          ))}
        </select>

        {/* custom font */}
        <FieldLabel>Custom Font</FieldLabel>
        <input
          type="text"
          value={fontUrl}
          onChange={(e) => setFontUrl(e.target.value)}
          placeholder="Enter Google Fonts URL or custom font URL"
          spellCheck={false}
          style={inputStyle}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: 11, color: "var(--paper-4)" }}>
            Try Google Fonts:{" "}
            <a href="https://fonts.google.com/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--paper-3)" }}>
              https://fonts.google.com/
            </a>
          </span>
          <button
            type="button"
            onClick={() => setShowExamples((v) => !v)}
            style={{ background: "transparent", border: 0, color: "var(--accent)", fontSize: 11, cursor: "pointer", padding: 0 }}
          >
            {showExamples ? "Hide examples" : "Show examples"}
          </button>
        </div>
        {showExamples && (
          <div style={{
            marginTop: 8, padding: "8px 10px", borderRadius: 6,
            background: "var(--ink-0)", border: "1px solid var(--line-soft)",
            display: "flex", flexDirection: "column", gap: 6,
          }}>
            {FONT_EXAMPLES.map((ex) => (
              <button
                key={ex.url}
                type="button"
                onClick={() => setFontUrl(ex.url)}
                className="mono"
                style={{
                  textAlign: "left", background: "transparent", border: 0, cursor: "pointer",
                  color: "var(--paper-3)", fontSize: 10.5, padding: "2px 0",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--paper)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--paper-3)")}
              >
                {ex.label} — {ex.url}
              </button>
            ))}
          </div>
        )}

        {/* page templates */}
        <FieldLabel>Page Templates</FieldLabel>
        <span style={{ fontSize: 11.5, color: "var(--paper-3)", lineHeight: 1.5, display: "block", marginBottom: 10 }}>
          The Monitor ships with a template you can edit in real time — drag columns,
          tune spacing and borders, then save it as your own.
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {CUSTOMIZE_PAGES.map((p, i) => (
            <PageTemplateRow
              key={p.id}
              index={i + 1}
              page={p}
              onEdit={() => { onClose(); navigate(p.editPath); }}
            />
          ))}
        </div>
      </div>

      {/* footer */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 8, padding: "12px 18px", borderTop: "1px solid var(--line-soft)",
      }}>
        <div style={{ display: "flex", gap: 8 }}>
          <FooterBtn onClick={exportTheme}><DownloadIcon /> Export</FooterBtn>
          <FooterBtn onClick={() => fileRef.current?.click()}><UploadIcon /> Import</FooterBtn>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importTheme(f); e.target.value = ""; }}
          />
        </div>
        <FooterBtn primary onClick={onClose}>Done</FooterBtn>
      </div>
    </>
  );
}

/* ───────────── pieces ───────────── */

function ThemeCard({
  preset,
  active,
  accentOverride,
  onClick,
}: {
  preset: ThemePreset;
  active: boolean;
  accentOverride?: string;
  onClick: () => void;
}) {
  const sw = themeSwatch(preset);
  const accent = accentOverride || sw.accent;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: "flex", flexDirection: "column", gap: 7,
        padding: 0, background: "transparent", border: 0, cursor: "pointer",
      }}
    >
      <div style={{
        position: "relative",
        height: 62,
        borderRadius: 9,
        overflow: "hidden",
        background: sw.bg,
        border: active ? `2px solid ${accent}` : "2px solid var(--line-soft)",
        boxShadow: active ? `0 0 0 3px color-mix(in oklch, ${accent} 22%, transparent)` : "none",
        transition: "border-color 120ms, box-shadow 120ms",
      }}>
        {/* accent side rail */}
        <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, background: accent }} />
        {/* two mock toggle pills */}
        <span style={{ position: "absolute", right: 10, top: 20, width: 20, height: 8, borderRadius: 999, background: sw.panel }} />
        <span style={{ position: "absolute", right: 10, top: 33, width: 20, height: 8, borderRadius: 999, background: accent, opacity: 0.9 }} />
        <span style={{ position: "absolute", left: 16, top: 18, width: 26, height: 6, borderRadius: 999, background: sw.panel }} />
        <span style={{ position: "absolute", left: 16, top: 30, width: 18, height: 6, borderRadius: 999, background: sw.panel, opacity: 0.6 }} />
      </div>
      <span style={{ fontSize: 11.5, color: active ? "var(--paper)" : "var(--paper-3)", fontWeight: active ? 600 : 500, textAlign: "center" }}>
        {preset.label}
      </span>
    </button>
  );
}

function PrimaryColorField({ value, onChange, onReset }: { value: string; onChange: (v: string) => void; onReset: () => void }) {
  const safe = /^#?[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : value;
  const withHash = safe.startsWith("#") ? safe : `#${safe}`;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: "var(--ink-0)", border: "1px solid var(--line-soft)",
      borderRadius: 8, padding: "7px 10px",
    }}>
      <label style={{ position: "relative", width: 26, height: 26, flexShrink: 0, cursor: "pointer" }}>
        <span style={{ display: "block", width: 26, height: 26, borderRadius: 6, background: withHash, border: "1px solid var(--line)" }} />
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash : "#526FFF"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
        />
      </label>
      <input
        type="text"
        value={value.replace(/^#/, "")}
        onChange={(e) => onChange(`#${e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 8)}`)}
        spellCheck={false}
        className="mono"
        style={{
          flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none",
          color: "var(--paper)", fontSize: 12, letterSpacing: "0.04em",
        }}
      />
      <Tooltip content="Reset to default (Dark · green)">
        <button
          type="button"
          aria-label="Reset primary colour"
          onClick={onReset}
          style={{
            width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: 0, borderRadius: 6, color: "var(--paper-3)", cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--paper)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--paper-3)")}
        >
          <ResetIcon />
        </button>
      </Tooltip>
    </div>
  );
}

function PageTemplateRow({ index, page, onEdit }: { index: number; page: PageDef; onEdit: () => void }) {
  const isPhone = useIsPhone();
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: isPhone ? "1fr" : "1fr auto",
      alignItems: isPhone ? "stretch" : "center",
      gap: 10,
      padding: "10px 12px",
      background: "var(--ink-0)",
      border: "1px solid var(--line-soft)",
      borderRadius: 9,
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12, color: "var(--paper)", fontWeight: 600 }}>{index}. {page.label}</span>
        <span style={{ fontSize: 10.5, color: "var(--paper-3)" }}>{page.description}</span>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="mono"
        style={{
          justifySelf: isPhone ? "stretch" : "end",
          display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px",
          fontSize: 10.5, letterSpacing: "0.04em", borderRadius: 6,
          border: "1px solid var(--line)",
          background: "transparent", color: "var(--paper-2)",
          cursor: "pointer",
          transition: "background 120ms, color 120ms",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ink-2)"; e.currentTarget.style.color = "var(--paper)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--paper-2)"; }}
      >
        Edit
      </button>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, color: "var(--paper)", fontWeight: 600, margin: "18px 0 8px" }}>
      {children}
    </div>
  );
}

function ZoomBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: "var(--ink-2)", border: "1px solid var(--line-soft)", borderRadius: 6,
        color: disabled ? "var(--paper-4)" : "var(--paper)", fontSize: 15,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
      }}
    >{label}</button>
  );
}

const resetPillStyle: React.CSSProperties = {
  padding: "0 12px", height: 28, fontSize: 10, letterSpacing: "0.08em",
  textTransform: "uppercase", background: "var(--ink-2)",
  border: "1px solid var(--line-soft)", borderRadius: 6, color: "var(--paper-2)", cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  background: "var(--ink-0)", border: "1px solid var(--line-soft)",
  borderRadius: 8, padding: "9px 11px", color: "var(--paper)", fontSize: 12,
  outline: "none",
};

function FooterBtn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "0 16px", height: 34, borderRadius: 8, fontSize: 12, fontWeight: 600,
        cursor: "pointer",
        border: "1px solid " + (primary ? "var(--accent)" : "var(--line-soft)"),
        background: primary ? "var(--accent)" : "transparent",
        color: primary ? "var(--ink-0)" : "var(--paper-2)",
        transition: "background 120ms, color 120ms, opacity 120ms",
      }}
      onMouseEnter={(e) => {
        if (primary) e.currentTarget.style.opacity = "0.88";
        else { e.currentTarget.style.background = "var(--ink-2)"; e.currentTarget.style.color = "var(--paper)"; }
      }}
      onMouseLeave={(e) => {
        if (primary) e.currentTarget.style.opacity = "1";
        else { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--paper-2)"; }
      }}
    >
      {children}
    </button>
  );
}

const FONT_EXAMPLES = [
  { label: "Roboto Mono", url: "https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;700&display=swap" },
  { label: "Sora",        url: "https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700&display=swap" },
  { label: "Outfit",      url: "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&display=swap" },
];

function ResetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13 8a5 5 0 1 1-1.46-3.54M13 3v2.5h-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 11.5V13a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 10V2M5 5l3-3 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 11.5V13a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
