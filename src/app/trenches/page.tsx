"use client";
import React, { useEffect, useState } from "react";
import { useClientSearchParams, useClientNav } from "../../components/shell/ClientPages";
import { DeployColumn } from "../../components/DeployColumn";
import { MigratingColumn } from "../../components/MigratingColumn";
import { MigrationColumn } from "../../components/MigrationColumn";
import { useSelectedToken } from "../../contexts/SelectedTokenContext";
import { useLastSeen } from "../../contexts/LastSeenContext";
import {
  COLUMN_LABEL,
  loadTemplate,
  saveTemplate,
  type MonitorTemplate,
  type Slot,
  type SlotStyle,
} from "../../lib/monitorTemplate";
import { CardStyleProvider } from "../../contexts/CardStyleContext";
import { useIsMobile } from "../../hooks/useMediaQuery";
import {
  EditorToolbar,
  SlotOverlay,
  StylePanel,
} from "../../components/MonitorEditor";
import { tokenHref } from "../../lib/tokenHref";

/**
 * Trenches: a launch's life in three live columns, always New, Migrating and
 * Migrated. Edit mode (?edit=1) styles them (width, padding, borders, card
 * size); the columns themselves are fixed. The ranking is Discover.
 */
export default function MonitorPage() {
  const search = useClientSearchParams();
  const editMode = search?.get("edit") === "1";
  const { setSelectedMint } = useSelectedToken();
  const { record } = useLastSeen();
  const isMobile = useIsMobile();
  const [template, setTemplateState] = useState<MonitorTemplate | null>(null);
  const [selectedSlotId, setSelectedSlotIdState] = useState<string | null>(null);
  const [panelCollapsed, setPanelCollapsedState] = useState(false);
  const [activeTabIdx, setActiveTabIdx] = useState(0);
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

  if (!template) {
    return <div style={{ flex: 1, minHeight: 0 }} />;
  }

  const renderSlot = (slot: Slot) => {
    switch (slot.type) {
      case "deploy":    return <DeployColumn    onSelect={select} />;
      case "migrating": return <MigratingColumn onSelect={select} />;
      case "migration": return <MigrationColumn onSelect={select} />;
    }
  };

  const exitEdit = () => {
    setSelectedSlotId(null);
    navigate("/trenches");
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
                  {renderSlot(activeSlot)}
                </div>
              </CardStyleProvider>
              {editMode && (
                <SlotOverlay
                  slot={activeSlot}
                  selected={selectedSlotId === activeSlot.id}
                  onSelect={() => setSelectedSlotId(activeSlot.id)}
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
                  {renderSlot(slot)}
                </div>
              </CardStyleProvider>
              {editMode && (
                <SlotOverlay
                  slot={slot}
                  selected={selectedSlotId === slot.id}
                  onSelect={() => setSelectedSlotId(slot.id)}
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
