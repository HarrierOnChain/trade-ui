"use client";
import { useEffect } from "react";
import { useUserPreference } from "./useUserPreference";

/**
 * Theme presets — Axiom-style "Customize Theme". A preset is a neutral base
 * palette (dark / light / dusk) plus a primary accent. The accent presets
 * (Astro / Neo / Crimson / Stealth Blue / Orange) all ride the dark base and
 * only swap the accent; Dark / Light / Dusk swap the neutral surfaces.
 *
 * The active accent is stored separately as `primary` (a hex string) so the
 * "Primary Color" field can override any preset's accent — editing the hex
 * flips the active preset to `custom` while keeping the neutral base.
 */

type BaseId = "dark" | "light" | "dusk";

export interface ThemePreset {
  id: string;
  label: string;
  base: BaseId;
  accent: string; // hex
}

// Swatch preview colours (bg / panel / accent) rendered on the picker card.
export interface ThemeSwatch {
  bg: string;
  panel: string;
  accent: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: "dark",    label: "Dark",         base: "dark",  accent: "#3DD96F" },
  { id: "light",   label: "Light",        base: "light", accent: "#2BAA56" },
  { id: "dusk",    label: "Dusk",         base: "dusk",  accent: "#4DA3FF" },
  { id: "astro",   label: "Astro",        base: "dark",  accent: "#BA49EE" },
  { id: "neo",     label: "Neo",          base: "dark",  accent: "#3DD96F" },
  { id: "crimson", label: "Crimson",      base: "dark",  accent: "#E84A4A" },
  { id: "stealth", label: "Stealth Blue", base: "dark",  accent: "#38BDF8" },
  { id: "orange",  label: "Orange",       base: "dark",  accent: "#F2A640" },
  { id: "custom",  label: "Custom",       base: "dark",  accent: "#526FFF" },
];

export const DEFAULT_THEME_ID = "dark";
export const DEFAULT_PRIMARY = "#3DD96F";
export const THEME_PREF_KEY = "spool.theme.preset";
export const PRIMARY_PREF_KEY = "spool.theme.primary";

// Neutral surface + text palettes. `dark` mirrors the :root defaults in
// globals.css exactly, so selecting Dark is a visual no-op.
const BASE_PALETTES: Record<BaseId, Record<string, string>> = {
  dark: {
    "--ink-0": "oklch(0.14 0.006 65)",
    "--ink-1": "oklch(0.17 0.006 65)",
    "--ink-2": "oklch(0.20 0.007 65)",
    "--ink-3": "oklch(0.24 0.008 65)",
    "--line": "oklch(0.28 0.008 65)",
    "--line-soft": "oklch(0.22 0.007 65)",
    "--paper": "oklch(0.96 0.012 85)",
    "--paper-2": "oklch(0.82 0.010 82)",
    "--paper-3": "oklch(0.60 0.008 80)",
    "--paper-4": "oklch(0.44 0.006 75)",
  },
  light: {
    "--ink-0": "oklch(0.985 0.003 85)",
    "--ink-1": "oklch(0.955 0.004 85)",
    "--ink-2": "oklch(0.915 0.005 85)",
    "--ink-3": "oklch(0.880 0.006 85)",
    "--line": "oklch(0.840 0.007 85)",
    "--line-soft": "oklch(0.900 0.005 85)",
    "--paper": "oklch(0.24 0.012 75)",
    "--paper-2": "oklch(0.40 0.011 75)",
    "--paper-3": "oklch(0.54 0.009 78)",
    "--paper-4": "oklch(0.66 0.007 80)",
  },
  dusk: {
    "--ink-0": "oklch(0.15 0.012 265)",
    "--ink-1": "oklch(0.18 0.014 265)",
    "--ink-2": "oklch(0.21 0.016 265)",
    "--ink-3": "oklch(0.25 0.018 265)",
    "--line": "oklch(0.30 0.020 265)",
    "--line-soft": "oklch(0.24 0.016 265)",
    "--paper": "oklch(0.95 0.010 250)",
    "--paper-2": "oklch(0.80 0.012 255)",
    "--paper-3": "oklch(0.62 0.014 258)",
    "--paper-4": "oklch(0.46 0.012 260)",
  },
};

const BASE_KEYS = Object.keys(BASE_PALETTES.dark);

export function getThemePreset(id: string): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0];
}

export function themeSwatch(p: ThemePreset): ThemeSwatch {
  const pal = BASE_PALETTES[p.base];
  return { bg: pal["--ink-0"], panel: pal["--ink-2"], accent: p.accent };
}

export function useThemePreset() {
  return useUserPreference<string>(THEME_PREF_KEY, DEFAULT_THEME_ID);
}

export function usePrimaryColor() {
  return useUserPreference<string>(PRIMARY_PREF_KEY, DEFAULT_PRIMARY);
}

// Darken / wash a hex primary into the -d / -w accent variants without a colour
// library. color-mix in oklch is supported across the app's target browsers.
function accentVars(primary: string): Record<string, string> {
  const d = `color-mix(in oklch, ${primary} 82%, black)`;
  const w = `color-mix(in oklch, ${primary} 14%, transparent)`;
  return {
    "--accent": primary, "--accent-d": d, "--accent-w": w,
    "--amber": primary, "--amber-d": d, "--amber-w": w,
  };
}

export function useApplyThemeMode() {
  const [presetId] = useThemePreset();
  const [primary] = usePrimaryColor();
  useEffect(() => {
    if (typeof document === "undefined") return;
    const preset = getThemePreset(presetId);
    const root = document.documentElement;
    const rs = root.style;
    const pal = BASE_PALETTES[preset.base];
    for (const k of BASE_KEYS) rs.setProperty(k, pal[k]);
    const accent = primary || preset.accent;
    const av = accentVars(accent);
    for (const [k, v] of Object.entries(av)) rs.setProperty(k, v);
    // Flag the base so components that must branch on light/dark can read it.
    root.setAttribute("data-theme-base", preset.base);
  }, [presetId, primary]);
}
