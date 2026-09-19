"use client";
import React, { useState } from "react";
import {
  COLUMN_LABEL,
  COLUMN_TYPES,
  DEFAULT_CARD_STYLE,
  DEFAULT_SLOT_STYLE,
  defaultTemplate,
  exportTemplate,
  importTemplate,
  makeId,
  type CardStyle,
  type ColumnType,
  type ContainerStyle,
  type MonitorTemplate,
  type Slot,
  type SlotStyle,
} from "../../lib/monitorTemplate";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";
import { Modal, Btn, ModalHeader, ModalFooter } from "../atoms";

const SWATCHES = [
  "var(--line-soft)",
  "var(--line)",
  "var(--paper-4)",
  "var(--accent)",
  "var(--buy)",
  "var(--sell)",
  "transparent",
];
const BG_SWATCHES = [
  "transparent",
  "var(--ink-0)",
  "var(--ink-1)",
  "var(--ink-2)",
];

// ── Toolbar ────────────────────────────────────────────────────────────
export function EditorToolbar({
  template,
  setTemplate,
  onDone,
}: {
  template: MonitorTemplate;
  setTemplate: (t: MonitorTemplate) => void;
  onDone: () => void;
}) {
  const [showIO, setShowIO] = useState<"import" | "export" | null>(null);
  const isPhone = useIsPhone();

  const addColumn = () => {
    const used = new Set(template.slots.map((s) => s.type));
    const fresh = COLUMN_TYPES.find((t) => !used.has(t)) ?? "deploy";
    setTemplate({
      ...template,
      slots: [...template.slots, {
        id: makeId(),
        type: fresh,
        style: { ...DEFAULT_SLOT_STYLE },
        card: { ...DEFAULT_CARD_STYLE },
      }],
    });
  };

  const reset = () => setTemplate(defaultTemplate());

  const allSparkOn = template.slots.length > 0 && template.slots.every((s) => s.card.showSparkline);
  const toggleSparklines = () => {
    const next = !allSparkOn;
    setTemplate({
      ...template,
      slots: template.slots.map((s) => ({ ...s, card: { ...s.card, showSparkline: next } })),
    });
  };

  return (
    <>
      <div style={{
        display: "flex", alignItems: "center",
        // On phones the six controls cannot fit one row at full text — wrap and
        // tighten the gap; desktop keeps the original single-row spacing.
        flexWrap: isPhone ? "wrap" : "nowrap",
        justifyContent: isPhone ? "flex-end" : undefined,
        gap: isPhone ? 6 : 10,
        padding: "8px 14px",
        borderBottom: "1px solid var(--line-soft)",
        background: "var(--ink-0)",
        flexShrink: 0,
      }}>
        {!isPhone && <div style={{ flex: 1 }} />}
        <ToolbarBtn kind="accent" onClick={addColumn} label="Add column" compact={isPhone}>
          {isPhone ? "+" : "+ Add column"}
        </ToolbarBtn>
        <ToolbarBtn
          kind={allSparkOn ? "accent" : "ghost"}
          onClick={toggleSparklines}
          label={allSparkOn ? "Sparklines on" : "Sparklines off"}
          compact={isPhone}
        >
          {isPhone ? "~" : (allSparkOn ? "Sparklines on" : "Sparklines off")}
        </ToolbarBtn>
        <ToolbarBtn onClick={reset} label="Reset" compact={isPhone}>
          {isPhone ? "R" : "Reset"}
        </ToolbarBtn>
        <ToolbarBtn onClick={() => setShowIO("import")} label="Import" compact={isPhone}>
          {isPhone ? "I" : "Import"}
        </ToolbarBtn>
        <ToolbarBtn onClick={() => setShowIO("export")} label="Export" compact={isPhone}>
          {isPhone ? "E" : "Export"}
        </ToolbarBtn>
        <ToolbarBtn kind="primary" onClick={onDone} label="Done" compact={isPhone}>
          {isPhone ? "✓" : "Done"}
        </ToolbarBtn>
      </div>
      {showIO && (
        <IOModal
          mode={showIO}
          template={template}
          onClose={() => setShowIO(null)}
          onImport={(t) => { setTemplate(t); setShowIO(null); }}
        />
      )}
    </>
  );
}

function ToolbarBtn({
  children, onClick, kind = "ghost", label, compact = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  kind?: "ghost" | "primary" | "accent";
  label?: string;
  compact?: boolean;
}) {
  const primary = kind === "primary";
  const accent = kind === "accent";
  const baseBg = primary
    ? "var(--accent)"
    : accent
      ? "color-mix(in oklch, var(--accent) 18%, transparent)"
      : "transparent";
  const baseColor = primary ? "var(--ink-0)" : accent ? "var(--accent)" : "var(--paper)";
  const baseBorder = primary || accent ? "1px solid var(--accent)" : "1px solid var(--line-soft)";
  const baseShadow = accent
    ? "0 0 0 1px color-mix(in oklch, var(--accent) 40%, transparent), 0 0 14px color-mix(in oklch, var(--accent) 35%, transparent)"
    : "none";
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={compact ? label : undefined}
      className={compact ? "tap-target" : undefined}
      style={{
        // Compact (phone) shows an icon/letter only — keep the hit target wide
        // enough to tap; desktop padding is untouched.
        padding: compact ? "5px 0" : "5px 12px",
        fontSize: 11,
        background: baseBg,
        color: baseColor,
        border: baseBorder,
        borderRadius: 999,
        cursor: "pointer",
        fontWeight: primary || accent ? 700 : 400,
        boxShadow: baseShadow,
        transition: "background 120ms, box-shadow 120ms, transform 120ms",
        letterSpacing: accent ? 0.3 : 0,
      }}
      onMouseEnter={(e) => {
        if (accent) {
          e.currentTarget.style.background = "color-mix(in oklch, var(--accent) 32%, transparent)";
          e.currentTarget.style.boxShadow =
            "0 0 0 1px var(--accent), 0 0 22px color-mix(in oklch, var(--accent) 60%, transparent)";
          e.currentTarget.style.transform = "translateY(-1px)";
        }
      }}
      onMouseLeave={(e) => {
        if (accent) {
          e.currentTarget.style.background = baseBg;
          e.currentTarget.style.boxShadow = baseShadow;
          e.currentTarget.style.transform = "translateY(0)";
        }
      }}
    >{children}</button>
  );
}

function IOModal({
  mode, template, onClose, onImport,
}: {
  mode: "import" | "export";
  template: MonitorTemplate;
  onClose: () => void;
  onImport: (t: MonitorTemplate) => void;
}) {
  const [text, setText] = useState(mode === "export" ? exportTemplate(template) : "");
  const [err, setErr] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();

  const apply = () => {
    const t = importTemplate(text);
    if (!t) { setErr("Invalid template JSON."); return; }
    onImport(t);
  };

  const copy = () => {
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  return (
    <Modal open onClose={onClose} width={520} mobileVariant="sheet">
      <ModalHeader
        title={mode === "export" ? "Export template" : "Import template"}
        onClose={onClose}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10, background: "var(--ink-1)" }}>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setErr(null); }}
          readOnly={mode === "export"}
          spellCheck={false}
          style={{
            background: "var(--ink-0)",
            border: "1px solid var(--line-soft)",
            color: "var(--paper)",
            borderRadius: 6,
            padding: 10,
            fontFamily: "Geist, -apple-system, system-ui, sans-serif",
            // Slightly larger text on phones for readability; cap the height so
            // the action buttons stay on-screen on short viewports.
            fontSize: isPhone ? 12 : 11,
            minHeight: isMobile ? "min(240px, 50dvh)" : 240,
            resize: "vertical",
            outline: "none",
          }}
        />
        {err && <span style={{ fontSize: 11, color: "var(--sell)" }}>{err}</span>}
      </div>
      <ModalFooter>
        {mode === "export"
          ? <Btn size="sm" onClick={copy}>Copy</Btn>
          : <Btn size="sm" tone="primary" onClick={apply}>Apply</Btn>}
      </ModalFooter>
    </Modal>
  );
}

// ── Per-column overlay ─────────────────────────────────────────────────
export function SlotOverlay({
  slot,
  selected,
  canRemove,
  onSelect,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  isDropTarget,
}: {
  slot: Slot;
  selected: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isDropTarget: boolean;
}) {
  return (
    <div
      onClick={onSelect}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        position: "absolute", inset: 0,
        zIndex: 30,
        cursor: "pointer",
        background: isDropTarget
          ? "oklch(0.85 0.15 145 / 0.08)"
          : selected
            ? "oklch(0.85 0.15 145 / 0.04)"
            : "transparent",
        outline: selected
          ? "2px solid var(--accent)"
          : isDropTarget
            ? "2px dashed var(--accent)"
            : "1px dashed oklch(0.85 0.15 145 / 0.3)",
        outlineOffset: -2,
        transition: "background 120ms ease, outline-color 120ms ease",
      }}
    >
      <div
        draggable
        onDragStart={onDragStart}
        onClick={(e) => e.stopPropagation()}
        title="Drag to reorder"
        style={{
          position: "absolute", top: 8, left: "50%",
          transform: "translateX(-50%)",
          padding: "4px 12px",
          background: "color-mix(in oklch, var(--accent) 18%, var(--ink-0))",
          border: "1px solid var(--accent)",
          borderRadius: 999,
          color: "var(--accent)",
          fontSize: 11,
          fontWeight: 700,
          cursor: "grab",
          display: "flex", alignItems: "center", gap: 6,
          userSelect: "none",
          boxShadow: "0 0 18px color-mix(in oklch, var(--accent) 40%, transparent), 0 6px 18px color-mix(in oklch, black 50%, transparent)",
          transition: "background 120ms, box-shadow 120ms",
          zIndex: 5,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "color-mix(in oklch, var(--accent) 30%, transparent)";
          e.currentTarget.style.boxShadow = "0 0 22px color-mix(in oklch, var(--accent) 55%, transparent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "color-mix(in oklch, var(--accent) 16%, transparent)";
          e.currentTarget.style.boxShadow = "0 0 14px color-mix(in oklch, var(--accent) 35%, transparent)";
        }}
      >
        <DragDots />
        <span className="mono" style={{ letterSpacing: "0.08em" }}>
          {COLUMN_LABEL[slot.type]}
        </span>
      </div>
      {canRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove column"
          style={{
            position: "absolute", top: 6, right: 6,
            width: 24, height: 24,
            background: "color-mix(in oklch, var(--accent) 16%, transparent)",
            border: "1px solid var(--accent)",
            borderRadius: 999,
            color: "var(--accent)",
            cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 15, lineHeight: 1, fontWeight: 700,
            boxShadow: "0 0 14px color-mix(in oklch, var(--accent) 35%, transparent)",
            transition: "background 120ms, box-shadow 120ms",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "color-mix(in oklch, var(--accent) 36%, transparent)";
            e.currentTarget.style.boxShadow = "0 0 22px color-mix(in oklch, var(--accent) 60%, transparent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "color-mix(in oklch, var(--accent) 16%, transparent)";
            e.currentTarget.style.boxShadow = "0 0 14px color-mix(in oklch, var(--accent) 35%, transparent)";
          }}
        >×</button>
      )}
    </div>
  );
}

function DragDots() {
  return (
    <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor" aria-hidden>
      <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" />
      <circle cx="2" cy="5" r="1" /><circle cx="6" cy="5" r="1" />
      <circle cx="2" cy="8" r="1" /><circle cx="6" cy="8" r="1" />
    </svg>
  );
}

// ── Style panel ────────────────────────────────────────────────────────
export function StylePanel({
  template, setTemplate, selectedSlotId, setSelectedSlotId,
  collapsed, onToggleCollapsed,
}: {
  template: MonitorTemplate;
  setTemplate: (t: MonitorTemplate) => void;
  selectedSlotId: string | null;
  setSelectedSlotId: (id: string | null) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();
  const slot = selectedSlotId ? template.slots.find((s) => s.id === selectedSlotId) ?? null : null;

  const updateSlotStyle = (patch: Partial<SlotStyle>) => {
    if (!slot) return;
    setTemplate({
      ...template,
      slots: template.slots.map((s) => s.id === slot.id ? { ...s, style: { ...s.style, ...patch } } : s),
    });
  };

  const updateCard = (patch: Partial<CardStyle>) => {
    if (!slot) return;
    setTemplate({
      ...template,
      slots: template.slots.map((s) => s.id === slot.id ? { ...s, card: { ...s.card, ...patch } } : s),
    });
  };

  const updateSlotType = (type: ColumnType) => {
    if (!slot) return;
    const dup = template.slots.findIndex((s) => s.type === type && s.id !== slot.id);
    setTemplate({
      ...template,
      slots: template.slots.map((s, i) => {
        if (s.id === slot.id) return { ...s, type };
        if (i === dup) return { ...s, type: slot.type };
        return s;
      }),
    });
  };

  const updateContainer = (patch: Partial<ContainerStyle>) => {
    setTemplate({ ...template, container: { ...template.container, ...patch } });
  };

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapsed}
        title="Expand style panel"
        aria-label="Expand style panel"
        className={isMobile ? "tap-target" : undefined}
        style={isMobile ? {
          // Mobile: a docked pill on the bottom-right, clear of the safe area,
          // so it never hides behind a notch or off the right edge.
          position: "fixed",
          bottom: "calc(var(--safe-b, 0px) + 12px)",
          right: "calc(var(--safe-r, 0px) + 12px)",
          height: 40,
          padding: "0 14px",
          background: "var(--ink-0)",
          border: "1px solid var(--line-soft)",
          borderRadius: 999,
          color: "var(--paper-3)",
          cursor: "pointer",
          zIndex: 80,
          boxShadow: "0 8px 22px -10px oklch(0 0 0 / 0.6)",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          fontSize: 12, fontWeight: 600,
        } : {
          position: "fixed",
          top: 96,
          right: 0,
          width: 26,
          height: 64,
          background: "var(--ink-0)",
          border: "1px solid var(--line-soft)",
          borderRight: 0,
          borderTopLeftRadius: 6,
          borderBottomLeftRadius: 6,
          color: "var(--paper-3)",
          cursor: "pointer",
          zIndex: 80,
          boxShadow: "-6px 8px 18px -10px oklch(0 0 0 / 0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 0,
        }}
      >
        {isMobile ? (
          <>
            <span className="mono" style={{ letterSpacing: "0.12em", textTransform: "uppercase" }}>Style</span>
            <svg width="12" height="10" viewBox="0 0 14 10" fill="none" aria-hidden>
              <path d="M2 7 7 3l5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </>
        ) : (
          <svg width="10" height="14" viewBox="0 0 10 14" fill="none" aria-hidden>
            <path d="M7 2 3 7l4 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    );
  }

  return (
    <div
      className={isMobile ? "app-scroll" : undefined}
      style={isMobile ? {
        // Mobile: bottom drawer / sheet — full width, slides up from the bottom,
        // capped height with safe-area padding and a scrollable body. The fixed
        // 280px right sidebar would otherwise claim the whole narrow viewport.
        position: "fixed",
        left: 0, right: 0, bottom: 0, top: "auto",
        width: "100%",
        maxHeight: "70dvh",
        border: "1px solid var(--line-soft)",
        borderBottom: 0,
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        background: "var(--ink-0)",
        overflowY: "auto",
        paddingBottom: "var(--safe-b, 0px)",
        display: "flex", flexDirection: "column",
        zIndex: 80,
        boxShadow: "0 -12px 32px -16px oklch(0 0 0 / 0.6)",
      } : {
      position: "fixed",
      top: 88, right: 8, bottom: 8,
      width: 280,
      border: "1px solid var(--line-soft)",
      borderRadius: 8,
      background: "var(--ink-0)",
      overflowY: "auto",
      display: "flex", flexDirection: "column",
      zIndex: 80,
      boxShadow: "-12px 14px 32px -16px oklch(0 0 0 / 0.55)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 10px 8px 14px",
        borderBottom: "1px solid var(--line-soft)",
        position: "sticky", top: 0,
        background: "var(--ink-0)",
        zIndex: 1,
      }}>
        <span className="mono" style={{
          fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "var(--paper-3)",
        }}>Style</span>
        <button
          onClick={onToggleCollapsed}
          title="Collapse panel"
          aria-label="Collapse panel"
          className={isMobile ? "tap-target" : undefined}
          style={{
            width: 22, height: 22,
            background: "transparent", border: 0,
            color: "var(--paper-3)", cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            borderRadius: 4,
          }}
        >
          {isMobile ? (
            // Bottom drawer collapses downward — point the chevron down.
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden>
              <path d="M2 3 7 7l5-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="10" height="14" viewBox="0 0 10 14" fill="none" aria-hidden>
              <path d="m3 2 4 5-4 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
      <PanelSection title="Container">
        <NumRow label="Padding X" value={template.container.paddingX} min={0} max={64}
          onChange={(v) => updateContainer({ paddingX: v })} />
        <NumRow label="Padding Y" value={template.container.paddingY} min={0} max={64}
          onChange={(v) => updateContainer({ paddingY: v })} />
        <NumRow label="Column gap" value={template.container.gap} min={0} max={32}
          onChange={(v) => updateContainer({ gap: v })} />
        <SwatchRow label="Background" value={template.container.background} options={BG_SWATCHES}
          onChange={(v) => updateContainer({ background: v })} />
      </PanelSection>

      <PanelSection title={slot ? `Column · ${COLUMN_LABEL[slot.type]}` : "Column"}>
        {!slot && (
          <span style={{ fontSize: 11, color: "var(--paper-4)" }}>
            Click a column to edit its styling.
          </span>
        )}
        {slot && (
          <>
            <FeedRow value={slot.type} onChange={updateSlotType} />
            <NumRow label="Flex weight" value={slot.style.flex} min={0.25} max={6} step={0.25}
              onChange={(v) => updateSlotStyle({ flex: v })} />
            <NumRow label="Padding X" value={slot.style.paddingX} min={0} max={48}
              onChange={(v) => updateSlotStyle({ paddingX: v })} />
            <NumRow label="Padding Y" value={slot.style.paddingY} min={0} max={48}
              onChange={(v) => updateSlotStyle({ paddingY: v })} />
            <NumRow label="Border width" value={slot.style.borderWidth} min={0} max={6}
              onChange={(v) => updateSlotStyle({ borderWidth: v })} />
            <SwatchRow label="Border color" value={slot.style.borderColor} options={SWATCHES}
              onChange={(v) => updateSlotStyle({ borderColor: v })} />
            <NumRow label="Border radius" value={slot.style.borderRadius} min={0} max={24}
              onChange={(v) => updateSlotStyle({ borderRadius: v })} />
            <SwatchRow label="Background" value={slot.style.background} options={BG_SWATCHES}
              onChange={(v) => updateSlotStyle({ background: v })} />
            <button
              onClick={() => updateSlotStyle({ ...DEFAULT_SLOT_STYLE })}
              style={{
                marginTop: 8,
                padding: "5px 10px",
                fontSize: 11,
                background: "transparent",
                color: "var(--paper-3)",
                border: "1px solid var(--line-soft)",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >Reset column style</button>
          </>
        )}
      </PanelSection>

      {slot && (
        <PanelSection title="Cards">
          <NumRow label="Scale" value={slot.card.scale} min={0.6} max={1.8} step={0.05}
            onChange={(v) => updateCard({ scale: v })} />
          <NumRow label="Row pad Y" value={slot.card.rowPaddingY} min={0} max={32}
            onChange={(v) => updateCard({ rowPaddingY: v })} />
          <NumRow label="Row pad X" value={slot.card.rowPaddingX} min={0} max={32}
            onChange={(v) => updateCard({ rowPaddingX: v })} />
          <NumRow label="Row gap" value={slot.card.rowGap} min={0} max={24}
            onChange={(v) => updateCard({ rowGap: v })} />
          <NumRow label="Row radius" value={slot.card.rowRadius} min={0} max={24}
            onChange={(v) => updateCard({ rowRadius: v })} />
          <NumRow label="Separator" value={slot.card.separatorOpacity} min={0} max={1} step={0.05}
            onChange={(v) => updateCard({ separatorOpacity: v })} />
          <NumRow label="Accent stripe" value={slot.card.accentWidth} min={0} max={8}
            onChange={(v) => updateCard({ accentWidth: v })} />
          {slot.card.accentWidth > 0 && (
            <SwatchRow label="Accent color" value={slot.card.accentColor} options={SWATCHES}
              onChange={(v) => updateCard({ accentColor: v })} />
          )}
          <ToggleRow label="Sparkline" value={slot.card.showSparkline}
            onChange={(v) => updateCard({ showSparkline: v })} />
          <ToggleRow label="Social links" value={slot.card.showSocials}
            onChange={(v) => updateCard({ showSocials: v })} />
          <button
            onClick={() => updateCard({ ...DEFAULT_CARD_STYLE })}
            style={{
              marginTop: 8,
              padding: "5px 10px",
              fontSize: 11,
              background: "transparent",
              color: "var(--paper-3)",
              border: "1px solid var(--line-soft)",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >Reset card style</button>
          <button
            onClick={() => setSelectedSlotId(null)}
            style={{
              marginTop: 4,
              padding: "5px 10px",
              fontSize: 11,
              background: "transparent",
              color: "var(--paper-4)",
              border: 0,
              cursor: "pointer",
              textAlign: "left",
            }}
          >Deselect</button>
        </PanelSection>
      )}
    </div>
  );
}

function ToggleRow({
  label, value, onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--paper-3)", cursor: "pointer" }}>
      <span style={{ flex: 1 }}>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        style={{
          width: 30, height: 16,
          borderRadius: 9,
          border: "1px solid var(--line-soft)",
          background: value ? "var(--accent)" : "var(--ink-1)",
          position: "relative",
          cursor: "pointer",
          padding: 0,
          transition: "background 140ms ease",
        }}
      >
        <span style={{
          position: "absolute",
          top: 1, left: value ? 15 : 1,
          width: 12, height: 12,
          borderRadius: "50%",
          background: value ? "var(--ink-0)" : "var(--paper-3)",
          transition: "left 140ms ease",
        }} />
      </button>
    </label>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: "12px 14px",
      borderBottom: "1px solid var(--line-soft)",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <span className="mono" style={{
        fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
        color: "var(--paper-4)",
      }}>{title}</span>
      {children}
    </div>
  );
}

function NumRow({
  label, value, min, max, step = 1, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const isPhone = useIsPhone();
  const slider = (
    <input
      type="range" min={min} max={max} step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{ flex: 2, minWidth: isPhone ? 0 : undefined, accentColor: "var(--accent)" }}
    />
  );
  const readout = (
    <span className="mono" style={{
      minWidth: 36, textAlign: "right",
      fontSize: 10, color: "var(--paper)",
    }}>{value}</span>
  );
  return (
    <label style={{
      display: "flex",
      // Phone: stack the label above the slider+readout row so the three
      // controls don't get crushed in a narrow drawer. Desktop stays inline.
      flexDirection: isPhone ? "column" : "row",
      alignItems: isPhone ? "stretch" : "center",
      gap: 8, fontSize: 11, color: "var(--paper-3)",
    }}>
      <span style={{ flex: 1 }}>{label}</span>
      {isPhone ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {slider}
          {readout}
        </div>
      ) : (
        <>
          {slider}
          {readout}
        </>
      )}
    </label>
  );
}

function SwatchRow({
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const isPhone = useIsPhone();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, color: "var(--paper-3)" }}>{label}</span>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {options.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            title={c}
            style={{
              // Phone swatches shrink fluidly so a full palette fits the narrow
              // drawer without an extra wrapped line; desktop keeps 22×22.
              width: isPhone ? "clamp(18px, 5vw, 22px)" : 22,
              height: isPhone ? "clamp(18px, 5vw, 22px)" : 22,
              flexShrink: isPhone ? 0 : undefined,
              borderRadius: 4,
              background: c === "transparent"
                ? "repeating-linear-gradient(45deg, var(--ink-2), var(--ink-2) 3px, var(--ink-1) 3px, var(--ink-1) 6px)"
                : c,
              border: value === c ? "2px solid var(--accent)" : "1px solid var(--line-soft)",
              cursor: "pointer",
              padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function FeedRow({
  value, onChange,
}: {
  value: ColumnType;
  onChange: (t: ColumnType) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--paper-3)" }}>
      <span style={{ flex: 1 }}>Feed</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ColumnType)}
        style={{
          flex: 2,
          background: "var(--ink-1)",
          border: "1px solid var(--line-soft)",
          color: "var(--paper)",
          borderRadius: 4,
          padding: "4px 6px",
          fontSize: 11,
          outline: "none",
        }}
      >
        {COLUMN_TYPES.map((t) => (
          <option key={t} value={t}>{COLUMN_LABEL[t]}</option>
        ))}
      </select>
    </label>
  );
}
