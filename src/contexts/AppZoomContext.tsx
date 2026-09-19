"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const LEGACY_STORAGE_KEY = "trade.appZoom";
const STORAGE_KEY = "trade.appZoom.v2";
const MODE_STORAGE_KEY = "trade.appZoom.mode";
const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 0.9;
const MAX_ZOOM = 1.25;
const ZOOM_STEP = 0.05;

// "Auto" scales the UI up on large monitors so the fixed-px chrome doesn't look
// tiny. Calibrated to real feedback rather than a linear width law: FHD ~1920
// wants 115%, but a 27" QHD (2560) wants ~110% — a WIDER screen wants slightly
// LESS zoom (physically bigger / viewed further), which a straight width ratio
// can't express. So we interpolate a hand-tuned curve that peaks at 1920 and
// eases down for very wide displays. Width only (innerHeight is eaten by browser
// chrome — a 1080p monitor reports ~940px, which would wrongly pin zoom to 100%).
// Never below 100%, never above 115%; manual zoom can still exceed via − / +.
const AUTO_MIN = 1.0;
const AUTO_MAX = 1.15;
const AUTO_CURVE: Array<[number, number]> = [
  [1366, 1.00],
  [1600, 1.05],
  [1920, 1.15],
  [2200, 1.12],
  [2560, 1.10],
  [3440, 1.08],
  [3840, 1.08],
];

type ZoomMode = "auto" | "manual";

type AppZoomContextValue = {
  zoom: number;          // effective zoom actually applied
  mode: ZoomMode;
  autoZoom: number;      // what Auto currently resolves to
  defaultZoom: number;
  minZoom: number;
  maxZoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  setZoom: (next: number | ((current: number) => number)) => void; // switches to manual
  enableAuto: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void; // re-enables Auto
};

const AppZoomContext = createContext<AppZoomContextValue | null>(null);

function clampZoom(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_ZOOM;
  const stepped = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(stepped.toFixed(2))));
}

function computeAutoZoom() {
  if (typeof window === "undefined") return DEFAULT_ZOOM;
  const w = window.innerWidth || 1920;
  const first = AUTO_CURVE[0];
  const last = AUTO_CURVE[AUTO_CURVE.length - 1];
  let z = last[1];
  if (w <= first[0]) {
    z = first[1];
  } else if (w >= last[0]) {
    z = last[1];
  } else {
    for (let i = 0; i < AUTO_CURVE.length - 1; i++) {
      const [w0, z0] = AUTO_CURVE[i];
      const [w1, z1] = AUTO_CURVE[i + 1];
      if (w >= w0 && w <= w1) {
        z = z0 + (z1 - z0) * ((w - w0) / (w1 - w0));
        break;
      }
    }
  }
  // Round to 0.01 (finer than the 0.05 manual step) so the curve isn't
  // collapsed onto the coarse grid — 1.12 must not snap to 1.10.
  return Math.min(AUTO_MAX, Math.max(AUTO_MIN, Math.round(z * 100) / 100));
}

export function AppZoomProvider({ children }: { children: React.ReactNode }) {
  const [manualZoom, setManualZoom] = useState(DEFAULT_ZOOM);
  const [mode, setModeState] = useState<ZoomMode>("auto");
  const [autoZoom, setAutoZoom] = useState(DEFAULT_ZOOM);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate stored preference. Migration: a user who previously pinned a manual
  // zoom (v2 key present) but has no explicit mode stays on manual; everyone
  // else defaults to Auto.
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      const rawZoom = window.localStorage.getItem(STORAGE_KEY);
      if (rawZoom != null) setManualZoom(clampZoom(Number(rawZoom)));
      const rawMode = window.localStorage.getItem(MODE_STORAGE_KEY);
      if (rawMode === "auto" || rawMode === "manual") {
        setModeState(rawMode);
      } else {
        setModeState(rawZoom != null ? "manual" : "auto");
      }
    } catch {
      // Ignore blocked storage; in-memory controls still work.
    } finally {
      setHydrated(true);
    }
  }, []);

  // Track the viewport for Auto. Recompute on resize and on DPR changes (an
  // OS scale change or moving the window to another monitor).
  useEffect(() => {
    const update = () => setAutoZoom(computeAutoZoom());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(manualZoom));
      window.localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch {
      // Best effort preference persistence.
    }
  }, [hydrated, manualZoom, mode]);

  const setZoom = useCallback<AppZoomContextValue["setZoom"]>((next) => {
    setManualZoom((current) => clampZoom(typeof next === "function" ? next(current) : next));
    setModeState("manual");
  }, []);

  const enableAuto = useCallback(() => setModeState("auto"), []);

  const value = useMemo<AppZoomContextValue>(() => {
    const zoom = mode === "auto" ? autoZoom : manualZoom;
    return {
      zoom,
      mode,
      autoZoom,
      defaultZoom: DEFAULT_ZOOM,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      canZoomIn: zoom < MAX_ZOOM,
      canZoomOut: zoom > MIN_ZOOM,
      setZoom,
      enableAuto,
      // Nudging from Auto starts from the resolved auto value so the first
      // step is relative to what the user currently sees.
      zoomIn: () => setZoom((current) => (mode === "auto" ? autoZoom : current) + ZOOM_STEP),
      zoomOut: () => setZoom((current) => (mode === "auto" ? autoZoom : current) - ZOOM_STEP),
      resetZoom: enableAuto,
    };
  }, [mode, autoZoom, manualZoom, setZoom, enableAuto]);

  return <AppZoomContext.Provider value={value}>{children}</AppZoomContext.Provider>;
}

export function useAppZoom() {
  const value = useContext(AppZoomContext);
  if (!value) throw new Error("useAppZoom must be used within AppZoomProvider");
  return value;
}
