"use client";
import React from "react";
import { Modal, Icon, ModalHeader } from "../atoms";
import { useApp } from "../../contexts/AppContext";
import { useIsMobile } from "../../hooks/useMediaQuery";
import {
  TOAST_POSITIONS,
  type ToastPosition,
  useNotifDisplay,
  useNotifAlerts,
  useNotifFillToasts,
  useNotifTweetAlerts,
  useNotifPosition,
  useNotifSound,
  useNotifVolume,
  playNotifTone,
} from "../../hooks/useNotifPrefs";

export function NotificationsModal() {
  const { notificationsOpen, closeNotifications } = useApp();
  const isMobile = useIsMobile();
  return (
    <Modal
      open={notificationsOpen}
      onClose={closeNotifications}
      width={480}
      align="center"
      mobileVariant={isMobile ? "sheet" : "center"}
    >
      <NotificationsBody onClose={closeNotifications} />
    </Modal>
  );
}

function NotificationsBody({ onClose }: { onClose: () => void }) {
  const [display, setDisplay] = useNotifDisplay();
  const [alerts, setAlerts] = useNotifAlerts();
  const [fillToasts, setFillToasts] = useNotifFillToasts();
  const [tweetAlerts, setTweetAlerts] = useNotifTweetAlerts();
  const [position, setPosition] = useNotifPosition();
  const [sound, setSound] = useNotifSound();
  const [volume, setVolume] = useNotifVolume();

  return (
    <>
      <ModalHeader title="Notifications" icon={Icon.notification(16)} onClose={onClose} />

      {/* body */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", background: "var(--ink-1)" }}>
        <ToggleRow
          label="Display notifications"
          hint="Show wallet-tracker and trade toasts on screen."
          on={display}
          onChange={setDisplay}
        />
        <ToggleRow
          label="Live alerts panel"
          hint="Show streaming alerts in the bell panel at the top right."
          on={alerts}
          onChange={setAlerts}
        />
        <ToggleRow
          label="Trade-fill toasts"
          hint="Pop a toast each time one of your buys or sells lands."
          on={fillToasts}
          onChange={setFillToasts}
          disabled={!display}
        />
        <ToggleRow
          label="Tweet alerts"
          hint="Toast + bell entry the moment a tracked X handle posts."
          on={tweetAlerts}
          onChange={setTweetAlerts}
        />

        <FieldLabel>Toast Position</FieldLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {TOAST_POSITIONS.map((p) => (
            <PositionCard
              key={p.id}
              pos={p.id}
              label={p.label}
              active={position === p.id}
              disabled={!display}
              onClick={() => setPosition(p.id)}
            />
          ))}
        </div>

        <FieldLabel>Transaction Sounds</FieldLabel>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 8,
          padding: "10px 12px",
        }}>
          <span style={{ fontSize: 12, color: "var(--paper)" }}>Play a sound when a trade lands</span>
          <Toggle on={sound} onChange={setSound} />
        </div>

        <div style={{ marginTop: 12, opacity: sound ? 1 : 0.5, pointerEvents: sound ? "auto" : "none" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "var(--paper-2)" }}>Notification Volume</span>
            <span className="mono" style={{ fontSize: 12, color: "var(--paper)" }}>{volume}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--accent)", cursor: "pointer" }}
          />

          <SoundRow label="Buy Sound" onPreview={() => playNotifTone("buy", volume / 100)} />
          <SoundRow label="Sell Sound" onPreview={() => playNotifTone("sell", volume / 100)} />
        </div>
      </div>

      {/* footer */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "flex-end",
        padding: "12px 18px", borderTop: "1px solid var(--line-soft)",
      }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            display: "inline-flex", alignItems: "center",
            padding: "0 18px", height: 34, borderRadius: 8, fontSize: 12, fontWeight: 600,
            cursor: "pointer", border: "1px solid var(--accent)",
            background: "var(--accent)", color: "var(--ink-0)",
            transition: "opacity 120ms",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.88")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          Done
        </button>
      </div>
    </>
  );
}

/* ───────── pieces ───────── */

function ToggleRow({
  label, hint, on, onChange, disabled,
}: {
  label: string; hint: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14,
      padding: "13px 0", borderBottom: "1px solid var(--line-soft)",
      opacity: disabled ? 0.5 : 1,
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, color: "var(--paper)", fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 11, color: "var(--paper-3)", lineHeight: 1.4 }}>{hint}</span>
      </div>
      <Toggle on={on} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function SoundRow({ label, onPreview }: { label: string; onPreview: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12 }}>
      <span style={{ fontSize: 12, color: "var(--paper-2)" }}>{label}</span>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 7,
        padding: "6px 8px 6px 11px",
      }}>
        <span style={{ display: "inline-flex", color: "var(--paper-3)" }}>{Icon.speaker(13)}</span>
        <span style={{ fontSize: 12, color: "var(--paper)", minWidth: 48 }}>Default</span>
        <button
          type="button"
          aria-label={`Preview ${label}`}
          onClick={onPreview}
          style={{
            width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "var(--ink-2)", border: "1px solid var(--line-soft)", borderRadius: 6,
            color: "var(--paper-2)", cursor: "pointer",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--paper)"; e.currentTarget.style.borderColor = "var(--accent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--paper-2)"; e.currentTarget.style.borderColor = "var(--line-soft)"; }}
        >
          <PlayIcon />
        </button>
      </div>
    </div>
  );
}

function PositionCard({
  pos, label, active, disabled, onClick,
}: {
  pos: ToastPosition; label: string; active: boolean; disabled?: boolean; onClick: () => void;
}) {
  const [v, h] = pos.split("-") as ["top" | "bottom", "left" | "center" | "right"];
  const justify = h === "left" ? "flex-start" : h === "right" ? "flex-end" : "center";
  const align = v === "top" ? "flex-start" : "flex-end";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      style={{
        display: "flex", flexDirection: "column", gap: 6, padding: 0,
        background: "transparent", border: 0,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <div style={{
        display: "flex", justifyContent: justify, alignItems: align,
        height: 52, padding: 7, borderRadius: 8,
        background: "var(--ink-0)",
        border: active ? "2px solid var(--accent)" : "2px solid var(--line-soft)",
        boxShadow: active ? "0 0 0 3px color-mix(in oklch, var(--accent) 20%, transparent)" : "none",
        transition: "border-color 120ms, box-shadow 120ms",
      }}>
        <span style={{
          display: "flex", alignItems: "center", gap: 3,
          width: 26, height: 9, borderRadius: 3,
          background: active ? "var(--accent)" : "var(--paper-4)",
          paddingLeft: 3,
        }}>
          <span style={{ width: 3, height: 3, borderRadius: 999, background: "var(--ink-0)" }} />
        </span>
      </div>
      <span style={{ fontSize: 11, textAlign: "center", color: active ? "var(--paper)" : "var(--paper-3)", fontWeight: active ? 600 : 500 }}>
        {label}
      </span>
    </button>
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        position: "relative",
        width: 40, height: 22, flexShrink: 0,
        borderRadius: 999,
        border: 0,
        background: on ? "var(--accent)" : "var(--ink-3)",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 140ms",
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: on ? 20 : 2,
        width: 18, height: 18, borderRadius: 999,
        background: "#fff",
        transition: "left 140ms",
      }} />
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, color: "var(--paper)", fontWeight: 600, margin: "18px 0 8px" }}>
      {children}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5 3.2v9.6a.5.5 0 0 0 .77.42l7.2-4.8a.5.5 0 0 0 0-.84l-7.2-4.8A.5.5 0 0 0 5 3.2Z" />
    </svg>
  );
}
