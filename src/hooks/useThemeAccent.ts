"use client";
import { useEffect } from "react";
import { useUserPreference } from "./useUserPreference";

export interface AccentPreset {
  id: string;
  label: string;
  base: string;
  dark: string;
  wash: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "violet", label: "Violet", base: "#BA49EE", dark: "#9933CC", wash: "rgb(186 73 238 / 0.14)" },
  { id: "blue",   label: "Blue",   base: "#4DA3FF", dark: "#2680E0", wash: "rgb(77 163 255 / 0.14)" },
  { id: "green",  label: "Green",  base: "#3DD96F", dark: "#2BAA56", wash: "rgb(61 217 111 / 0.14)" },
  { id: "amber",  label: "Amber",  base: "#F2A640", dark: "#D08820", wash: "rgb(242 166 64 / 0.14)" },
  { id: "red",    label: "Red",    base: "#E84A4A", dark: "#C03030", wash: "rgb(232 74 74 / 0.14)" },
  { id: "cyan",   label: "Cyan",   base: "#45D8E0", dark: "#2BAEBF", wash: "rgb(69 216 224 / 0.14)" },
  { id: "pink",   label: "Pink",   base: "#F26BD3", dark: "#C944A9", wash: "rgb(242 107 211 / 0.14)" },
];

export const DEFAULT_ACCENT_ID = "green";
export const ACCENT_PREF_KEY = "spool.theme.accent";

export function getAccentPreset(id: string): AccentPreset {
  return ACCENT_PRESETS.find((p) => p.id === id) ?? ACCENT_PRESETS.find((p) => p.id === DEFAULT_ACCENT_ID)!;
}

export function useThemeAccent() {
  return useUserPreference<string>(ACCENT_PREF_KEY, DEFAULT_ACCENT_ID);
}

export function useApplyThemeAccent() {
  const [accentId] = useThemeAccent();
  useEffect(() => {
    if (typeof document === "undefined") return;
    const p = getAccentPreset(accentId);
    const root = document.documentElement.style;
    root.setProperty("--accent",   p.base);
    root.setProperty("--accent-d", p.dark);
    root.setProperty("--accent-w", p.wash);
    root.setProperty("--amber",    p.base);
    root.setProperty("--amber-d",  p.dark);
    root.setProperty("--amber-w",  p.wash);
  }, [accentId]);
}
