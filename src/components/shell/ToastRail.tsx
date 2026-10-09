"use client";
import React, { useEffect } from "react";
import { useApp } from "../../contexts/AppContext";
import { useIsPhone } from "../../hooks/useMediaQuery";
import {
  toastRailStyle,
  useNotifDisplay,
  useNotifFillToasts,
  useNotifPosition,
  useNotifSound,
  useNotifVolume,
  playNotifTone,
} from "../../hooks/useNotifPrefs";

/// Stacks newest-on-top via `column-reverse` so the most recent toast
/// stays anchored at the bottom-right and prior toasts shift up. Click-
/// through is allowed on the rail itself; only the cards intercept
/// pointer events. Position + gating come from the Notifications settings.
export function ToastRail() {
  const { toasts } = useApp();
  const [display] = useNotifDisplay();
  const [fillToasts] = useNotifFillToasts();
  const [position] = useNotifPosition();
  const isPhone = useIsPhone();

  if (!display) return null;

  // Trade-fill toasts carry a buy/sell tone; suppress them when the user turns
  // that class off, while keeping neutral/info toasts (disconnect, errors…).
  const shown = fillToasts ? toasts : toasts.filter((t) => t.tone !== "buy" && t.tone !== "sell");

  return (
    <div className="toast-rail" style={isPhone ? undefined : toastRailStyle(position)}>
      {shown.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}

type ToneKey = "buy" | "sell" | "default";

function ToastCard({ toast: t }: { toast: ReturnType<typeof useApp>["toasts"][number] }) {
  const [sound] = useNotifSound();
  const [volume] = useNotifVolume();
  const tone: ToneKey = t.tone ?? "default";
  const duration = t.duration ?? 4200;
  const kicker = tone === "buy" ? "BUY" : tone === "sell" ? "SELL" : "INFO";

  // Play the configured cue once when the toast first appears.
  useEffect(() => {
    if (sound) playNotifTone(tone, volume / 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`toast-card toast-card--${tone}`}
      style={{ ["--toast-duration" as unknown as string]: `${duration}ms` }}
      role="status"
    >
      <span className="toast-card__rail" aria-hidden="true" />
      <span className="toast-card__dot" aria-hidden="true" />
      <span className="toast-card__kicker-tone">{kicker}</span>
      <span className="toast-card__kicker-sep" aria-hidden="true">·</span>
      <span className="toast-card__title">{t.title}</span>
      {t.body && (
        <>
          <span className="toast-card__kicker-sep" aria-hidden="true">·</span>
          <span className="toast-card__msg">{t.body}</span>
        </>
      )}
      <span className="toast-card__progress" aria-hidden="true" />
    </div>
  );
}
