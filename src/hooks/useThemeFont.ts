"use client";
import { useEffect } from "react";
import { useUserPreference } from "./useUserPreference";

export interface FontPreset {
  id: string;
  label: string;
  // Full CSS font-family stack written to `--font-ui` / `--font-mono` / `--font-dis`.
  stack: string;
  // `family=` segment for Google Fonts; null = OS font, no remote load.
  googleFamilyParam: string | null;
}

export const FONT_PRESETS: FontPreset[] = [
  { id: "geist",            label: "Geist (default)",   stack: '"Geist", -apple-system, system-ui, sans-serif',           googleFamilyParam: "Geist:wght@100;200;300;400;500;600;700;800;900" },
  { id: "inter",            label: "Inter",             stack: '"Inter", -apple-system, system-ui, sans-serif',           googleFamilyParam: "Inter:wght@300;400;500;600;700" },
  { id: "ibm-plex-sans",    label: "IBM Plex Sans",     stack: '"IBM Plex Sans", -apple-system, system-ui, sans-serif',   googleFamilyParam: "IBM+Plex+Sans:wght@300;400;500;600;700" },
  { id: "space-grotesk",    label: "Space Grotesk",     stack: '"Space Grotesk", -apple-system, system-ui, sans-serif',   googleFamilyParam: "Space+Grotesk:wght@300;400;500;600;700" },
  { id: "jetbrains-mono",   label: "JetBrains Mono",    stack: '"JetBrains Mono", ui-monospace, monospace',               googleFamilyParam: "JetBrains+Mono:wght@300;400;500;600;700" },
  { id: "ibm-plex-mono",    label: "IBM Plex Mono",     stack: '"IBM Plex Mono", ui-monospace, monospace',                googleFamilyParam: "IBM+Plex+Mono:wght@300;400;500;600;700" },
  { id: "instrument-serif", label: "Instrument Serif",  stack: '"Instrument Serif", ui-serif, Georgia, serif',            googleFamilyParam: "Instrument+Serif:ital@0;1" },
  { id: "system",           label: "System default",    stack: "-apple-system, system-ui, sans-serif",                    googleFamilyParam: null },
];

export const DEFAULT_FONT_ID = "geist";
export const FONT_PREF_KEY = "spool.theme.font";
// A raw Google Fonts (or custom stylesheet) URL that overrides the preset when
// set. Empty string = use the FONT_PRESETS selection.
export const FONT_URL_PREF_KEY = "spool.theme.fontUrl";

export function getFontPreset(id: string): FontPreset {
  return FONT_PRESETS.find((p) => p.id === id) ?? FONT_PRESETS[0];
}

export function useThemeFont() {
  return useUserPreference<string>(FONT_PREF_KEY, DEFAULT_FONT_ID);
}

export function useThemeCustomFont() {
  return useUserPreference<string>(FONT_URL_PREF_KEY, "");
}

// Pull the first family name out of a Google Fonts URL (…?family=Roboto+Slab:…)
// so we can point --font-* at it. Returns null for non-parseable URLs.
export function familyFromFontUrl(url: string): string | null {
  const m = url.match(/[?&]family=([^&:]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, " ")).trim() || null;
  } catch {
    return m[1].replace(/\+/g, " ").trim() || null;
  }
}

export function useApplyThemeFont() {
  const [fontId] = useThemeFont();
  const [customUrl] = useThemeCustomFont();
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement.style;
    const url = customUrl.trim();
    if (url) {
      ensureCustomFontLoaded(url);
      const family = familyFromFontUrl(url);
      if (family) {
        const stack = `"${family}", -apple-system, system-ui, sans-serif`;
        root.setProperty("--font-ui", stack);
        root.setProperty("--font-mono", stack);
        root.setProperty("--font-dis", stack);
        return;
      }
      // Non-Google URL: we injected the stylesheet but can't infer the family,
      // so fall through to the preset stack for the actual font-family vars.
    }
    const p = getFontPreset(fontId);
    if (p.googleFamilyParam) ensureGoogleFontLoaded(p.id, p.googleFamilyParam);
    root.setProperty("--font-ui",   p.stack);
    root.setProperty("--font-mono", p.stack);
    root.setProperty("--font-dis",  p.stack);
  }, [fontId, customUrl]);
}

// Inject an arbitrary stylesheet URL once (keyed by href) for custom fonts.
function ensureCustomFontLoaded(href: string) {
  const existing = document.querySelector(`link[data-spool-custom-font]`) as HTMLLinkElement | null;
  if (existing) {
    if (existing.href === href) return;
    existing.href = href;
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute("data-spool-custom-font", "1");
  document.head.appendChild(link);
}

// Inject a Google Fonts <link> on first use of a non-default family. Idempotent —
// every family lives behind a stable id so re-selecting the same preset is free
// and switching back to a previously-loaded family is instant.
function ensureGoogleFontLoaded(id: string, familyParam: string) {
  const linkId = `spool-font-${id}`;
  if (document.getElementById(linkId)) return;
  const link = document.createElement("link");
  link.id = linkId;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${familyParam}&display=swap`;
  document.head.appendChild(link);
}
