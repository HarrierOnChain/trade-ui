"use client";
import type React from "react";
import { useUserPreference } from "./useUserPreference";

// Notification preferences — shared by the Notifications modal (the UI) and the
// toast/alert plumbing (ToastRail, AlertBell) that actually enforces them.

export const NOTIF_KEYS = {
  display:       "spool.notif.display.v1",     // master: render toasts at all
  alertsEnabled: "spool.notif.alerts.v1",      // bell panel (top-right)
  fillToasts:    "spool.notif.fillToasts.v1",  // buy/sell fill toasts
  tweetAlerts:   "spool.notif.tweetAlerts.v1", // tracked X-handle tweets (toast + bell)
  position:      "spool.notif.position.v1",    // toast-rail corner
  sound:         "spool.notif.toastSound.v1",  // transaction sounds master
  volume:        "spool.notif.volume.v1",      // 0–100
} as const;

export type ToastPosition =
  | "top-left" | "top-center" | "top-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export const TOAST_POSITIONS: { id: ToastPosition; label: string }[] = [
  { id: "top-left", label: "Top Left" },
  { id: "top-center", label: "Top Center" },
  { id: "top-right", label: "Top Right" },
  { id: "bottom-left", label: "Bottom Left" },
  { id: "bottom-center", label: "Bottom Center" },
  { id: "bottom-right", label: "Bottom Right" },
];

export const DEFAULT_POSITION: ToastPosition = "bottom-right";

export const useNotifDisplay = () => useUserPreference<boolean>(NOTIF_KEYS.display, true);
export const useNotifAlerts = () => useUserPreference<boolean>(NOTIF_KEYS.alertsEnabled, true);
export const useNotifFillToasts = () => useUserPreference<boolean>(NOTIF_KEYS.fillToasts, true);
// One switch for the whole tweet lane: OFF tears down the live subscription,
// so it silences both the toast and the bell entry.
export const useNotifTweetAlerts = () => useUserPreference<boolean>(NOTIF_KEYS.tweetAlerts, true);
export const useNotifPosition = () => useUserPreference<ToastPosition>(NOTIF_KEYS.position, DEFAULT_POSITION);
export const useNotifSound = () => useUserPreference<boolean>(NOTIF_KEYS.sound, false);
export const useNotifVolume = () => useUserPreference<number>(NOTIF_KEYS.volume, 50);

// Inline style that repositions `.toast-rail` to the chosen corner. Overrides
// the stylesheet default (bottom-right). Top corners stack newest-on-top
// (column), bottom corners keep newest-at-bottom (column-reverse).
export function toastRailStyle(pos: ToastPosition): React.CSSProperties {
  const [v, h] = pos.split("-") as ["top" | "bottom", "left" | "center" | "right"];
  const s: React.CSSProperties = {
    top: "auto", bottom: "auto", left: "auto", right: "auto",
    transform: "none",
    flexDirection: v === "top" ? "column" : "column-reverse",
    alignItems: h === "left" ? "flex-start" : h === "right" ? "flex-end" : "center",
  };
  if (v === "top") s.top = 24; else s.bottom = 24;
  if (h === "left") s.left = 24;
  else if (h === "right") s.right = 24;
  else { s.left = "50%"; s.transform = "translateX(-50%)"; }
  return s;
}

// Short synthesized cue on a landed toast — no audio assets needed. Buy is a
// bright high tone, sell a lower one, everything else a neutral mid tone.
export function playNotifTone(kind: "buy" | "sell" | "default", volume01: number) {
  if (typeof window === "undefined") return;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = kind === "buy" ? 880 : kind === "sell" ? 440 : 660;
    const peak = Math.max(0, Math.min(1, volume01)) * 0.16;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    osc.start(t);
    osc.stop(t + 0.2);
    osc.onended = () => { try { void ctx.close(); } catch { /* ignore */ } };
  } catch {
    /* audio blocked / unsupported — silent */
  }
}
