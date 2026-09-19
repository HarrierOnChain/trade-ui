"use client";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useClientSearchParams, useClientNav } from "../../components/shell/ClientPages";
import { DeployColumn } from "../../components/DeployColumn";
import { MigratingColumn } from "../../components/MigratingColumn";
import { MigrationColumn } from "../../components/MigrationColumn";
import { TrendingColumn } from "../../components/TrendingColumn";
import { WatchlistColumn } from "../../components/WatchlistColumn";
import { useSelectedToken } from "../../contexts/SelectedTokenContext";
import { useLastSeen } from "../../contexts/LastSeenContext";
import {
  COLUMN_LABEL,
  COLUMN_TYPES,
  loadTemplate,
  saveTemplate,
  type ColumnType,
  type MonitorTemplate,
  type Slot,
  type SlotStyle,
} from "../../lib/monitorTemplate";
import { CardStyleProvider } from "../../contexts/CardStyleContext";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";
import { clampLeft, clampTop, viewportMaxWidth } from "../../lib/popover";
import {
  EditorToolbar,
  SlotOverlay,
  StylePanel,
} from "../../components/MonitorEditor";
import { tokenHref } from "../../lib/tokenHref";

export default function MonitorPage() {
  const search = useClientSearchParams();
  const editMode = search?.get("edit") === "1";
  const { setSelectedMint } = useSelectedToken();
  const { record } = useLastSeen();
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();
  const [template, setTemplateState] = useState<MonitorTemplate | null>(null);
  const [selectedSlotId, setSelectedSlotIdState] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [panelCollapsed, setPanelCollapsedState] = useState(false);
  const [activeTabIdx, setActiveTabIdx] = useState(0);
  const dragSrcRef = useRef<string | null>(null);
  const { navigate } = useClientNav();

  useEffect(() => {
    setTemplateState(loadTemplate());
    try {
      const v = localStorage.getItem("monitor:edit-panel-collapsed");
      if (v === "1") setPanelCollapsedState(true);
    } catch {}
  }, []);

  const setPanelCollapsed = (v: boolean) => {
    setPanelCollapsedState(v);
    try { localStorage.setItem("monitor:edit-panel-collapsed", v ? "1" : "0"); } catch {}
  };

  // Selecting a slot auto-expands the panel so the user can see its controls.
  const setSelectedSlotId = (id: string | null) => {
    setSelectedSlotIdState(id);
    if (id && panelCollapsed) setPanelCollapsed(false);
  };

  const setTemplate = (t: MonitorTemplate) => {
    setTemplateState(t);
    saveTemplate(t);
  };

  const select = (mint: string) => {
    setSelectedMint(mint);
    record(mint);
    navigate(tokenHref(mint));
  };

  const setSlotType = (slotId: string, value: ColumnType) => {
    if (!template) return;
    const dup = template.slots.findIndex((s) => s.type === value && s.id !== slotId);
    setTemplate({
      ...template,
      slots: template.slots.map((s, i) => {
        if (s.id === slotId) return { ...s, type: value };
        if (i === dup) {
          const cur = template.slots.find((x) => x.id === slotId);
          return { ...s, type: cur ? cur.type : s.type };
        }
        return s;
      }),
    });
  };

  const removeSlot = (slotId: string) => {
    if (!template || template.slots.length <= 1) return;
    setTemplate({ ...template, slots: template.slots.filter((s) => s.id !== slotId) });
    if (selectedSlotId === slotId) setSelectedSlotId(null);
  };

  const reorder = (srcId: string, targetId: string) => {
    if (!template || srcId === targetId) return;
    const slots = [...template.slots];
    const srcIdx = slots.findIndex((s) => s.id === srcId);
    const tgtIdx = slots.findIndex((s) => s.id === targetId);
    if (srcIdx < 0 || tgtIdx < 0) return;
    const [moved] = slots.splice(srcIdx, 1);
    slots.splice(tgtIdx, 0, moved);
    setTemplate({ ...template, slots });
  };

  if (!template) {
    return <div style={{ flex: 1, minHeight: 0 }} />;
  }

  const renderSlot = (slot: Slot, idx: number, all: Slot[]) => {
    const used = new Set(all.filter((_, j) => j !== idx).map((s) => s.type));
    const options = COLUMN_TYPES.filter((t) => t === slot.type || !used.has(t));
    const titleSlot = (
      <ColumnTitleWheel
        value={slot.type}
        options={options}
        onChange={(v) => setSlotType(slot.id, v)}
      />
    );
    switch (slot.type) {
      case "trending":  return <TrendingColumn  onSelect={select} titleSlot={titleSlot} />;
      case "deploy":    return <DeployColumn    onSelect={select} titleSlot={titleSlot} />;
      case "migrating": return <MigratingColumn onSelect={select} titleSlot={titleSlot} />;
      case "migration": return <MigrationColumn onSelect={select} titleSlot={titleSlot} />;
      case "watchlist": return <WatchlistColumn onSelect={select} titleSlot={titleSlot} />;
    }
  };

  const exitEdit = () => {
    setSelectedSlotId(null);
    navigate("/monitor");
  };

  const clampedTabIdx = Math.min(activeTabIdx, template.slots.length - 1);

  if (isMobile) {
    const activeSlot = template.slots[clampedTabIdx];
    return (
      <div style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: "column" }}>
        {editMode && (
          <EditorToolbar
            template={template}
            setTemplate={setTemplate}
            onDone={exitEdit}
          />
        )}
        {template.slots.length > 1 && (
          <div style={{
            display: "flex",
            flexShrink: 0,
            borderBottom: "1px solid var(--line-soft)",
            overflowX: "auto",
            background: template.container.background || "var(--ink)",
          }}>
            {template.slots.map((slot, i) => (
              <button
                key={slot.id}
                onClick={() => setActiveTabIdx(i)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "10px 12px",
                  fontSize: 13,
                  fontWeight: i === clampedTabIdx ? 700 : 500,
                  color: i === clampedTabIdx ? "var(--paper)" : "var(--paper-3)",
                  background: "none",
                  border: "none",
                  borderBottom: i === clampedTabIdx ? "2px solid var(--accent)" : "2px solid transparent",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "color 160ms ease, border-color 160ms ease",
                  outline: "none",
                  letterSpacing: "-0.01em",
                }}
              >
                {COLUMN_LABEL[slot.type]}
              </button>
            ))}
          </div>
        )}
        <div style={{
          display: "flex",
          flex: 1, minHeight: 0,
          overflow: "hidden",
          position: "relative",
          background: template.container.background,
        }}>
          {activeSlot && (
            <SlotShell
              key={activeSlot.id}
              style={activeSlot.style}
              editing={editMode}
              isMobile={true}
              showDivider={false}
            >
              <CardStyleProvider value={activeSlot.card}>
                <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
                  {renderSlot(activeSlot, clampedTabIdx, template.slots)}
                </div>
              </CardStyleProvider>
              {editMode && (
                <SlotOverlay
                  slot={activeSlot}
                  selected={selectedSlotId === activeSlot.id}
                  canRemove={template.slots.length > 1}
                  onSelect={() => setSelectedSlotId(activeSlot.id)}
                  onRemove={() => { removeSlot(activeSlot.id); setActiveTabIdx(0); }}
                  onDragStart={(e) => {
                    dragSrcRef.current = activeSlot.id;
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    if (dragSrcRef.current && dragSrcRef.current !== activeSlot.id) {
                      e.preventDefault();
                      setDropTarget(activeSlot.id);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const src = dragSrcRef.current;
                    dragSrcRef.current = null;
                    setDropTarget(null);
                    if (src) reorder(src, activeSlot.id);
                  }}
                  isDropTarget={dropTarget === activeSlot.id}
                />
              )}
            </SlotShell>
          )}
          {editMode && (
            <StylePanel
              template={template}
              setTemplate={setTemplate}
              selectedSlotId={selectedSlotId}
              setSelectedSlotId={setSelectedSlotId}
              collapsed={panelCollapsed}
              onToggleCollapsed={() => setPanelCollapsed(!panelCollapsed)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", flex: 1, minHeight: 0,
      flexDirection: "column",
    }}>
      {editMode && (
        <EditorToolbar
          template={template}
          setTemplate={setTemplate}
          onDone={exitEdit}
        />
      )}
      <div style={{
        display: "flex",
        flex: 1, minHeight: 0,
        overflow: "hidden",
        position: "relative",
      }}>
        <div
          style={{
          display: "flex",
          flexDirection: "row",
          flex: 1, minHeight: 0,
          overflow: "hidden",
          padding: `${template.container.paddingY}px ${template.container.paddingX}px`,
          gap: template.container.gap,
          background: template.container.background,
        }}>
          {template.slots.map((slot, i) => (
            <SlotShell
              key={slot.id}
              style={slot.style}
              editing={editMode}
              isMobile={false}
              showDivider={!editMode && template.container.gap === 0 && i > 0}
            >
              <CardStyleProvider value={slot.card}>
                <div style={{
                  flex: 1, minWidth: 0, minHeight: 0, display: "flex",
                  zoom: slot.card.scale,
                } as React.CSSProperties}>
                  {renderSlot(slot, i, template.slots)}
                </div>
              </CardStyleProvider>
              {editMode && (
                <SlotOverlay
                  slot={slot}
                  selected={selectedSlotId === slot.id}
                  canRemove={template.slots.length > 1}
                  onSelect={() => setSelectedSlotId(slot.id)}
                  onRemove={() => removeSlot(slot.id)}
                  onDragStart={(e) => {
                    dragSrcRef.current = slot.id;
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    if (dragSrcRef.current && dragSrcRef.current !== slot.id) {
                      e.preventDefault();
                      setDropTarget(slot.id);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const src = dragSrcRef.current;
                    dragSrcRef.current = null;
                    setDropTarget(null);
                    if (src) reorder(src, slot.id);
                  }}
                  isDropTarget={dropTarget === slot.id}
                />
              )}
            </SlotShell>
          ))}
        </div>
        {editMode && (
          <StylePanel
            template={template}
            setTemplate={setTemplate}
            selectedSlotId={selectedSlotId}
            setSelectedSlotId={setSelectedSlotId}
            collapsed={panelCollapsed}
            onToggleCollapsed={() => setPanelCollapsed(!panelCollapsed)}
          />
        )}
      </div>
    </div>
  );
}

function SlotShell({
  children, style, editing, isMobile, showDivider,
}: {
  children: React.ReactNode;
  style: SlotStyle;
  editing: boolean;
  isMobile: boolean;
  showDivider: boolean;
}) {
  return (
    <>
      {showDivider && (
        <div style={{
          // In the mobile column stack this divider is a horizontal rule.
          width: isMobile ? "100%" : 1,
          height: isMobile ? 1 : undefined,
          background: "var(--line-soft)",
          flexShrink: 0,
        }} />
      )}
      <div style={{
        position: "relative",
        flex: isMobile ? "1 1 0" : style.flex,
        width: isMobile ? "100%" : undefined,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        padding: `${style.paddingY}px ${style.paddingX}px`,
        border: style.borderWidth > 0 ? `${style.borderWidth}px solid ${style.borderColor}` : "none",
        borderRadius: style.borderRadius,
        background: style.background,
        boxSizing: "border-box",
        overflow: "hidden",
        containerType: "inline-size",
        transition: editing ? "flex 200ms ease, padding 160ms ease, border-radius 160ms ease" : undefined,
      } as React.CSSProperties}>
        {children}
      </div>
    </>
  );
}

// ── Title-wheel ────────────────────────────────────────────────────────────
const ITEM_H = 24;

function ColumnTitleWheel({
  value, options, onChange,
}: {
  value: ColumnType;
  options: ColumnType[];
  onChange: (v: ColumnType) => void;
}) {
  const opts = options.length > 0 ? options : [value];
  const idx = Math.max(0, opts.indexOf(value));
  const len = opts.length;
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(120);

  useEffect(() => {
    if (!measureRef.current) return;
    const spans = Array.from(measureRef.current.querySelectorAll("span")) as HTMLSpanElement[];
    const max = Math.max(...spans.map((s) => s.offsetWidth));
    if (max > 0) setWidth(Math.ceil(max));
  }, []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      if (!triggerRef.current) return;
      const r = triggerRef.current.getBoundingClientRect();
      setRect({ top: r.top, left: r.left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      const portal = document.getElementById(`wheel-portal`);
      if (portal?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cycle = (dir: 1 | -1) => {
    if (len <= 1) return;
    const next = (idx + dir + len) % len;
    onChange(opts[next]);
  };

  const pick = (t: ColumnType) => {
    if (t !== value) onChange(t);
    window.setTimeout(() => setOpen(false), 240);
  };

  return (
    <div
      ref={triggerRef}
      style={{
        position: "relative",
        display: "inline-block",
        height: ITEM_H,
        width,
        lineHeight: 1,
      }}
    >
      <div
        ref={measureRef}
        aria-hidden
        style={{
          position: "absolute", visibility: "hidden", pointerEvents: "none",
          height: 0, overflow: "hidden", whiteSpace: "nowrap",
        }}
      >
        {COLUMN_TYPES.map((t) => (
          <span
            key={t}
            style={{ fontSize: 15, fontStyle: "normal", fontWeight: 700, letterSpacing: "-0.01em", marginRight: 8 }}
          >{COLUMN_LABEL[t]}</span>
        ))}
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { if (len > 1) setOpen((o) => !o); }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && len > 1) {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          height: ITEM_H,
          lineHeight: `${ITEM_H}px`,
          fontSize: 15,
          fontStyle: "normal",
          fontWeight: 700,
          letterSpacing: "-0.01em",
          color: "var(--paper)",
          whiteSpace: "nowrap",
          cursor: "pointer",
          opacity: open ? 0 : 1,
          transition: "opacity 140ms ease",
          outline: "none",
          userSelect: "none",
        }}
      >
        {COLUMN_LABEL[value]}
      </div>

      <div
        style={{
          position: "absolute", bottom: 0, left: 0,
          width: 14, borderTop: "1px dotted var(--paper-4)",
          opacity: open ? 0 : (hover ? 0.9 : 0.3),
          transition: "opacity 200ms ease",
          pointerEvents: "none",
        }}
      />

      {open && rect && typeof document !== "undefined" && createPortal(
        <WheelPortal
          rect={rect}
          width={width}
          idx={idx}
          opts={opts}
          onPick={pick}
          onCycle={cycle}
        />,
        document.body,
      )}
    </div>
  );
}

function WheelPortal({
  rect, width, idx, opts, onPick, onCycle,
}: {
  rect: { top: number; left: number };
  width: number;
  idx: number;
  opts: ColumnType[];
  onPick: (t: ColumnType) => void;
  onCycle: (dir: 1 | -1) => void;
}) {
  const len = opts.length;
  const VISIBLE_SLOTS = Math.min(Math.max(len, 1), 4);
  const stack: ColumnType[] = Array.from({ length: len * 3 }, (_, p) => opts[p % len]);
  const activePos = len + idx;
  const stackTranslateY = ITEM_H - activePos * ITEM_H;

  // Keep the floating wheel fully on-screen: on a narrow phone the anchored
  // column title can sit near the right edge and push this menu off-viewport.
  // The popover helpers internally guard `window`/`document` for SSR safety.
  const menuHeight = VISIBLE_SLOTS * ITEM_H;
  const left = clampLeft(rect.left, width);
  const top = clampTop(rect.top - ITEM_H, menuHeight);

  return (
    <div
      id="wheel-portal"
      onWheel={(e) => { e.preventDefault(); onCycle(e.deltaY > 0 ? 1 : -1); }}
      style={{
        position: "fixed",
        top,
        left,
        width,
        maxWidth: viewportMaxWidth(),
        height: menuHeight,
        zIndex: 60,
        overflow: "hidden",
        animation: "wheelOpen 200ms cubic-bezier(0.22, 1, 0.36, 1) both",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "var(--ink-1)",
          boxShadow: [
            "0 1px 0 oklch(0 0 0 / 0.4)",
            "0 14px 32px -16px oklch(0 0 0 / 0.7)",
            "inset 0 0 0 1px var(--line-soft)",
          ].join(", "),
          borderRadius: 4,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 0, right: 0, top: 0,
          transform: `translateY(${stackTranslateY}px)`,
          transition: "transform 280ms cubic-bezier(0.22, 1, 0.36, 1)",
          willChange: "transform",
        }}
      >
        {stack.map((t, p) => {
          const isActive = p === activePos;
          return (
            <div
              key={p}
              role="option"
              aria-selected={isActive}
              onClick={(e) => { e.stopPropagation(); onPick(t); }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = "var(--paper-2)";
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = "var(--paper-3)";
              }}
              style={{
                height: ITEM_H,
                lineHeight: `${ITEM_H}px`,
                fontSize: 15,
                fontStyle: "normal",
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: isActive ? "var(--paper)" : "var(--paper-3)",
                cursor: isActive ? "default" : "pointer",
                transition: "color 200ms ease",
                whiteSpace: "nowrap",
                userSelect: "none",
              }}
            >
              {COLUMN_LABEL[t]}
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: "absolute",
          top: ITEM_H,
          left: 0, right: 0,
          height: 1,
          background: "var(--line)",
          opacity: 0.85,
          pointerEvents: "none",
          animation: "wheelRailIn 220ms ease-out 60ms both",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 2 * ITEM_H - 1,
          left: 0, right: 0,
          height: 1,
          background: "var(--line)",
          opacity: 0.85,
          pointerEvents: "none",
          animation: "wheelRailIn 220ms ease-out 60ms both",
        }}
      />

      <style>{`
        @keyframes wheelOpen {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes wheelRailIn {
          from { opacity: 0; transform: scaleX(0.4); }
          to   { opacity: 0.85; transform: scaleX(1); }
        }
      `}</style>
    </div>
  );
}
