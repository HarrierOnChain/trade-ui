"use client";
/* ───────────────────────────────────────────────────────────────────────────
   Spool · Orbit  ·  Chain-trending overview

   Single fixed real-time view. Backend (`trending.live`) maintains a rolling
   in-memory snapshot fed from raze WS — this page is a thin viewport over
   that state plus three lenses (orbit / grid / heat) and a working inspector.

   No period switcher: backend gives us live state, we show it. Ring placement
   in orbit mode is purely token-age based.
   ─────────────────────────────────────────────────────────────────────────── */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { useClientNav } from "../../components/shell/ClientPages";
import { useSelectedToken } from "../../contexts/SelectedTokenContext";
import { useLastSeen } from "../../contexts/LastSeenContext";
import { useTrendingSnapshot, type TrendingEntry } from "../../hooks/useTrendingSnapshot";
import { useTrendingX } from "../../hooks/useTrendingX";
import { TrendingXColumn } from "../../components/TrendingXColumn";
import type { TokenEvent } from "../../types";
import { dexColor, fmtMcap, shortAddr } from "../../lib/format";
import { tokenHref } from "../../lib/tokenHref";
import { useHiddenTokens } from "../../lib/hiddenTokens";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { fluidColsFit } from "../../lib/responsive";
import { viewportMaxWidth } from "../../lib/popover";

// ── ring ladder (token-age based) ────────────────────────────────────────────
// Each ring is a *disjoint* age band: ring i covers
//   [previousBound, this.minutes)   (with `previousBound = 0` for ring 0).
// Tokens older than the outermost visible bound are not placed — they're
// outside the user's selected viewport. We surface a small "+ N older"
// counter so nothing silently disappears.
//
// `minutes` is the upper bound of the band; `label` is the upper-bound
// shorthand. Disjoint range strings like "5m – 1h" are derived per-render
// from neighbour bounds in `visibleRings`.
//
// Capped at 3d because raze's upstream rankings only stretch ~3 days back;
// deeper tiers would be empty.
const RING_LADDER = [
  { minutes: 5,    label: "5m" },
  { minutes: 60,   label: "1h" },
  { minutes: 1440, label: "24h" },
  { minutes: 4320, label: "3d" },
] as const;
const MIN_RINGS = 1;
const MAX_RINGS = RING_LADDER.length;
const DEFAULT_RINGS = 3;
/** Log₁₀ slider values (0..9 → $1..$1B) for default mcap band. */
const DEFAULT_MCAP_FLOOR = Math.log10(5_000);
const DEFAULT_MCAP_CEILING = Math.log10(500_000);

type Mode = "orbit" | "grid" | "heat";
type Direction = "all" | "up" | "down";

/**
 * useState backed by localStorage. Initial render uses `initial` (so SSR
 * and first client paint agree); on mount we replace it with whatever
 * was previously persisted. Writes are debounced into a single setItem
 * call per change. `validate` lets us reject malformed stored values
 * (older format, hand-edited, etc.) and fall back to the default.
 */
function usePersistedState<T>(
  key: string,
  initial: T,
  validate: (v: unknown) => v is T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const fullKey = `trade.trending.${key}.v1`;
  const [state, setState] = useState<T>(initial);
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(fullKey);
      if (raw != null) {
        const parsed = JSON.parse(raw) as unknown;
        if (validate(parsed)) setState(parsed);
      }
    } catch { /* malformed → keep initial */ }
    hydrated.current = true;
    // validate is referentially stable (defined at module scope below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey]);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(fullKey, JSON.stringify(state));
    } catch { /* quota / private mode — non-fatal */ }
  }, [fullKey, state]);

  return [state, setState];
}

// Validators — single-source-of-truth for each persisted shape. Used by
// usePersistedState above to reject anything that doesn't match what the
// hook expects.
const isMode = (v: unknown): v is Mode => v === "orbit" || v === "grid" || v === "heat";
const isDirection = (v: unknown): v is Direction => v === "all" || v === "up" || v === "down";
const isMcapSliderValue = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 9;
const isProtoFilter = (v: unknown): v is string | null =>
  v === null || (typeof v === "string" && v.length > 0 && v.length < 64);
const isMintList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((m) => typeof m === "string" && m.length > 0 && m.length < 80);
const isZoomLevel = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= MIN_RINGS && v <= MAX_RINGS;
const isOnOff = (v: unknown): v is "on" | "off" => v === "on" || v === "off";

// ════════════════════════════════════════════════════════════════════════════
// root
// ════════════════════════════════════════════════════════════════════════════
export default function TrendingPage() {
  const { navigate } = useClientNav();
  const { setSelectedMint } = useSelectedToken();
  const { record } = useLastSeen();
  const isMobile = useIsMobile();

  const snap = useTrendingSnapshot(200);
  // Shared hidden-tokens registry (localStorage, cross-tab). Hiding here
  // also takes the mint out of Portfolio, Monitor, Tracker, etc.
  const { hiddenMints, isHidden, hide, unhide } = useHiddenTokens();
  const entries = snap.entries;

  // ── ui state ──
  // Persisted across reload / page switch (localStorage). Validators above
  // reject malformed values so a corrupt entry can't break the page.
  const [mode, setMode] = usePersistedState<Mode>("mode", "orbit", isMode);
  const [direction, setDir] = usePersistedState<Direction>("direction", "up", isDirection);
  // mcap range — log slider 0..9 → $1 .. $1B.
  // floor=0 means "no minimum"; ceiling=9 means "no maximum".
  const [mcapFloor, setFloor] = usePersistedState<number>("mcapFloor", DEFAULT_MCAP_FLOOR, isMcapSliderValue);
  const [mcapCeiling, setCeiling] = usePersistedState<number>("mcapCeiling", DEFAULT_MCAP_CEILING, isMcapSliderValue);
  const [protoFilter, setPF] = usePersistedState<string | null>("protoFilter", null, isProtoFilter);
  const [pinned, setPinned] = usePersistedState<string[]>("pinned", [], isMintList);
  // How many concentric rings to show in the orbit (1..MAX_RINGS).
  // Driven by scroll wheel and the ± controls in the orbit corner.
  const [zoom, setZoom] = usePersistedState<number>("zoom", DEFAULT_RINGS, isZoomLevel);
  // X Intel column (curated-KOL tweet feed + token mentions). Toggleable —
  // hidden = zero xshot traffic (the data hook only mounts with the column).
  const [xIntel, setXIntel] = usePersistedState<"on" | "off">("xIntel", "on", isOnOff);
  // Ephemeral — resets each time the page mounts.
  const [explicitSel, setExplicitSel] = useState<string | null>(null);
  const events = useRecentEvents(entries);

  const togglePin = useCallback((mint: string) => {
    setPinned((p) => p.includes(mint) ? p.filter((m) => m !== mint) : [...p, mint]);
  }, []);

  // Hide / unhide actions. When hiding the currently-inspected token, drop
  // any pin + explicit selection on it so the inspector cleanly falls back
  // to "Pick a token from the constellation" instead of pointing at a now-
  // invisible row.
  const hideToken = useCallback((tok: TrendingEntry) => {
    hide(tok.mint, { symbol: tok.symbol || undefined, name: tok.name || undefined });
    setPinned((p) => p.filter((m) => m !== tok.mint));
    setExplicitSel((sel) => (sel === tok.mint ? null : sel));
  }, [hide]);
  const unhideToken = useCallback((mint: string) => unhide(mint), [unhide]);

  // ── filters ──
  const filtered = useMemo(() => {
    // Floor at 0 = OFF (entries with unknown mcap also pass through).
    // Ceiling at 9 ($1B) = OFF. Numeric tests only run when the slider is
    // off the rest position — unknown-mcap entries fall through both.
    const applyFloor = mcapFloor > 0;
    const applyCeiling = mcapCeiling < 9;
    const floor = Math.pow(10, mcapFloor);
    const ceiling = Math.pow(10, mcapCeiling);
    return entries.filter((e) => {
      if (hiddenMints.has(e.mint)) return false;
      if (protoFilter && (e.dex || "").toLowerCase() !== protoFilter) return false;
      if (direction === "up" && (e.priceChangePct ?? 0) < 0) return false;
      if (direction === "down" && (e.priceChangePct ?? 0) >= 0) return false;
      if (applyFloor && (e.marketCap ?? 0) < floor) return false;
      if (applyCeiling && (e.marketCap ?? 0) > ceiling) return false;
      return true;
    });
  }, [entries, direction, mcapFloor, mcapCeiling, protoFilter, hiddenMints]);

  // ── selection: explicit > most-recent pinned ──
  const selectedMint = useMemo(() => {
    if (explicitSel) return explicitSel;
    if (pinned.length === 0) return null;
    return pinned[pinned.length - 1] ?? null;
  }, [explicitSel, pinned]);
  const inspected = useMemo(
    () => entries.find((e) => e.mint === selectedMint) ?? null,
    [entries, selectedMint],
  );

  // ── derived stats ──
  const totalMcap = entries.reduce((s, e) => s + (e.marketCap ?? 0), 0);
  const upCount = filtered.filter((e) => (e.priceChangePct ?? 0) >= 0).length;
  const downCount = filtered.length - upCount;

  // ── nav ──
  const openToken = useCallback((mint: string) => {
    setSelectedMint(mint);
    record(mint);
    navigate(tokenHref(mint));
  }, [navigate, setSelectedMint, record]);

  // ── keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (e.key.toLowerCase() === "o") setMode("orbit");
      else if (e.key.toLowerCase() === "g") setMode("grid");
      else if (e.key.toLowerCase() === "h") setMode("heat");
      else if (e.key.toLowerCase() === "x") setXIntel((v) => v === "on" ? "off" : "on");
      else if (e.key === "Escape") setExplicitSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reference the unused-after-redesign values so React/TS doesn't warn —
  // they remain useful inside FilterRail / InspectorRail panels.
  void totalMcap; void upCount; void downCount;

  return (
    <div className={isMobile ? "app-scroll" : undefined} style={{
      flex: 1, display: "flex", flexDirection: "column", minHeight: 0,
      background: "var(--ink-0)",
      fontFeatureSettings: "'tnum' 1, 'cv11' 1",
    }}>
      {/* Desktop: fixed 3-column board (260 + 1fr + 320). Mobile: a single
          stacked column — rails collapse to full-width auto-height blocks and
          the viewport gets a tall fixed band so orbit/grid/heat stay usable
          while the page itself scrolls (`.app-scroll` above). */}
      <div style={{
        flex: 1, display: "grid",
        gridTemplateColumns: isMobile
          ? "1fr"
          : xIntel === "on" ? "260px 1fr 300px 320px" : "260px 1fr 320px",
        gap: 1, background: "var(--line-soft)",
        minHeight: 0,
      }}>
        <FilterRail
          isMobile={isMobile}
          pool={entries}
          filtered={filtered}
          direction={direction} setDir={setDir}
          mcapFloor={mcapFloor} setFloor={setFloor}
          mcapCeiling={mcapCeiling} setCeiling={setCeiling}
          protoFilter={protoFilter} setPF={setPF}
          mode={mode} setMode={setMode}
          xIntel={xIntel} setXIntel={setXIntel}
        />

        <Viewport
          isMobile={isMobile}
          mode={mode}
          tokens={filtered}
          loading={snap.loading}
          pinned={pinned} togglePin={togglePin}
          selectedMint={selectedMint} setSel={setExplicitSel}
          openToken={openToken}
          zoom={zoom} setZoom={setZoom}
        />

        {xIntel === "on" && (
          <TrendingXIntel
            tokens={filtered}
            selectedMint={selectedMint}
            onClearSelectedMint={() => setExplicitSel(null)}
            onSelectToken={setExplicitSel}
          />
        )}

        <InspectorRail
          isMobile={isMobile}
          token={inspected}
          events={events}
          openToken={openToken}
          isPinned={inspected ? pinned.includes(inspected.mint) : false}
          togglePin={togglePin}
          isHidden={inspected ? isHidden(inspected.mint) : false}
          hideToken={hideToken}
          unhideToken={unhideToken}
        />
      </div>
    </div>
  );
}

// header bar removed — its pieces now live in the side rails (BrandSection
// + RailHeader). Only the small chrome components below are reused.

/**
 * Official Solana brand mark — three angled bars with the canonical
 * green→purple gradient. Rendered as SVG <g> so it composes inside the
 * orbit's parent SVG. Translates to (cx, cy) so callers position from
 * the center.
 *
 * Source artwork is 397.7 × 311.7; we scale it down to `size` and recenter.
 */
function SolanaMark({ cx, cy, size }: { cx: number; cy: number; size: number }) {
  const SRC_W = 397.7;
  const SRC_H = 311.7;
  const scale = size / SRC_W;
  const w = SRC_W * scale;
  const h = SRC_H * scale;
  const tx = cx - w / 2;
  const ty = cy - h / 2;
  return (
    <g transform={`translate(${tx} ${ty}) scale(${scale})`} aria-label="Solana">
      <defs>
        <linearGradient id="sol-grad-top" x1="360.879" y1="-37.455" x2="141.213" y2="383.294" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
        <linearGradient id="sol-grad-mid" x1="264.829" y1="-87.601" x2="45.163" y2="333.148" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
        <linearGradient id="sol-grad-bot" x1="312.548" y1="-62.696" x2="92.882" y2="358.052" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
      </defs>
      <path
        fill="url(#sol-grad-top)"
        d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"
      />
      <path
        fill="url(#sol-grad-mid)"
        d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z"
      />
      <path
        fill="url(#sol-grad-bot)"
        d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"
      />
    </g>
  );
}

function SpoolGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      style={{ animation: "spool-rot 22s linear infinite" }}>
      <circle cx="12" cy="12" r="10" fill="none"
        stroke="var(--paper-4)" strokeWidth="1" strokeDasharray="2 3" />
      <circle cx="12" cy="12" r="6" fill="none"
        stroke="var(--amber)" strokeWidth="1" strokeDasharray="3 2" />
      <circle cx="12" cy="12" r="2.4" fill="var(--amber)" />
      <style>{`@keyframes spool-rot{to{transform:rotate(360deg);transform-origin:center;}}`}</style>
    </svg>
  );
}

function ModeToggle({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const modes: Array<{ id: Mode; glyph: ReactNode; label: string }> = [
    { id: "orbit", glyph: <ModeOrbit />, label: "Orbit (O)" },
    { id: "grid", glyph: <ModeGrid />, label: "Grid (G)" },
    { id: "heat", glyph: <ModeHeat />, label: "Heat (H)" },
  ];
  return (
    <div style={{
      display: "flex", border: "1px solid var(--line)", borderRadius: 3, overflow: "hidden",
    }}>
      {modes.map((m) => {
        const on = mode === m.id;
        return (
          <button key={m.id}
            onClick={() => setMode(m.id)}
            title={m.label}
            style={{
              width: 28, height: 26,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: on ? "var(--paper)" : "transparent",
              color: on ? "var(--ink-0)" : "var(--paper-3)",
              border: "none", borderRight: "1px solid var(--line)",
              cursor: "pointer", transition: "background 100ms",
            }}>
            {m.glyph}
          </button>
        );
      })}
    </div>
  );
}
function ModeOrbit() {
  return <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" /><circle cx="8" cy="8" r="1.5" fill="currentColor" />
    <circle cx="14" cy="8" r="1" fill="currentColor" /></svg>;
}
function ModeGrid() {
  return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor">
    <rect x="2" y="2" width="5" height="5" /><rect x="9" y="2" width="5" height="5" />
    <rect x="2" y="9" width="5" height="5" /><rect x="9" y="9" width="5" height="5" /></svg>;
}
function ModeHeat() {
  return <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
    <rect x="1" y="1" width="9" height="9" /><rect x="11" y="1" width="4" height="4" opacity="0.6" />
    <rect x="11" y="6" width="4" height="4" opacity="0.4" /><rect x="1" y="11" width="6" height="4" opacity="0.5" />
    <rect x="8" y="11" width="7" height="4" opacity="0.3" /></svg>;
}

function ConnDot({ live, lastUpdateAt }: { live: boolean; lastUpdateAt: number | null }) {
  const fresh = lastUpdateAt != null && Date.now() - lastUpdateAt < 10_000;
  const color = live ? (fresh ? "var(--buy)" : "var(--amber)") : "var(--sell)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%", background: color,
        boxShadow: `0 0 8px ${color}`,
        animation: live ? "conn-pulse 1.6s ease-in-out infinite" : undefined,
      }} />
      <span className="mono eyebrow" style={{
        fontSize: 8, color: "var(--paper-4)", letterSpacing: "0.18em",
      }}>{live ? (fresh ? "LIVE" : "IDLE") : "OFFLINE"}</span>
      <style>{`@keyframes conn-pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// filter rail (left)
// ════════════════════════════════════════════════════════════════════════════
// ── X Intel column wrapper ───────────────────────────────────────────────
// Mounted only while the column is open, so a hidden column costs zero
// xshot traffic (no KOL backfill, no live tweet subscriptions).
function TrendingXIntel({
  tokens, selectedMint, onClearSelectedMint, onSelectToken,
}: {
  tokens: TrendingEntry[];
  selectedMint: string | null;
  onClearSelectedMint: () => void;
  onSelectToken: (mint: string) => void;
}) {
  // Minimal TokenEvent projection — the mention matcher only reads
  // mint_address / symbol / name / twitter (trending entries carry no
  // twitter handle, so "official" matches simply never fire here).
  const xTokens = useMemo<TokenEvent[]>(() => tokens.slice(0, 120).map((e) => ({
    mint_address: e.mint,
    name: e.name,
    symbol: e.symbol,
    dex: e.dex,
    image: e.image,
    marketCap: e.marketCap ?? undefined,
    created_at: new Date(e.createdAt).toISOString(),
  })), [tokens]);
  const x = useTrendingX(xTokens);
  return (
    <TrendingXColumn
      tokens={xTokens}
      kols={x.kols}
      tweets={x.tweets}
      loading={x.loading}
      error={x.error}
      selectedMint={selectedMint}
      onClearSelectedMint={onClearSelectedMint}
      onSelectToken={onSelectToken}
    />
  );
}

interface FilterRailProps {
  isMobile?: boolean;
  pool: TrendingEntry[];
  filtered: TrendingEntry[];
  direction: Direction; setDir: (d: Direction) => void;
  mcapFloor: number; setFloor: (n: number) => void;
  mcapCeiling: number; setCeiling: (n: number) => void;
  protoFilter: string | null; setPF: (s: string | null) => void;
  mode: Mode; setMode: (m: Mode) => void;
  xIntel: "on" | "off"; setXIntel: React.Dispatch<React.SetStateAction<"on" | "off">>;
}
function FilterRail(p: FilterRailProps) {
  const groups = useMemo(() => {
    const acc: Record<string, { count: number; mcap: number; ups: number }> = {};
    p.pool.forEach((t) => {
      const dex = (t.dex || "other").toLowerCase();
      if (!acc[dex]) acc[dex] = { count: 0, mcap: 0, ups: 0 };
      acc[dex].count += 1;
      acc[dex].mcap += t.marketCap ?? 0;
      if ((t.priceChangePct ?? 0) >= 0) acc[dex].ups += 1;
    });
    return Object.entries(acc).sort((a, b) => b[1].mcap - a[1].mcap);
  }, [p.pool]);
  const totalMcap = groups.reduce((s, [, v]) => s + v.mcap, 0) || 1;

  return (
    <div className={p.isMobile ? "app-scroll" : undefined} style={{
      background: "var(--ink-1)",
      display: "flex", flexDirection: "column",
      overflow: "auto", minHeight: 0,
      // On phones the rail can't be a fixed-width sidebar; cap its height so
      // the stacked viewport below it stays on-screen and the rail scrolls.
      maxHeight: p.isMobile ? "46dvh" : undefined,
    }}>
      <BrandSection mode={p.mode} setMode={p.setMode} />
      <RailSection>
        <FilterRow label="Direction">
          <SegToggle value={p.direction} onChange={p.setDir} options={[
            { id: "all", label: "ALL", color: "var(--paper)" },
            { id: "up", label: "UP", color: "var(--buy)" },
            { id: "down", label: "DOWN", color: "var(--sell)" },
          ]} />
        </FilterRow>
        <FilterRow label="X Intel  · KOL tweets (X)">
          <SegToggle value={p.xIntel} onChange={p.setXIntel} options={[
            { id: "on", label: "ON", color: "var(--accent)" },
            { id: "off", label: "OFF", color: "var(--paper)" },
          ]} />
        </FilterRow>
        <FilterRow label={p.mcapFloor > 0 ? `MCap floor  ≥ $${fmtFloor(p.mcapFloor)}` : "MCap floor  · OFF"}>
          <input type="range" min="0" max="9" step="0.1"
            value={p.mcapFloor}
            onChange={(e) => {
              const v = Number(e.target.value);
              p.setFloor(v);
              // Keep floor < ceiling. Bump the ceiling along if the user
              // pushes the floor past it.
              if (v >= p.mcapCeiling) p.setCeiling(Math.min(9, v + 0.1));
            }}
            style={{ width: "100%", accentColor: "var(--amber)" }} />
          <div style={{
            display: "flex", justifyContent: "space-between",
            fontFamily: "var(--font-mono)", fontSize: 8,
            color: "var(--paper-4)", marginTop: 2,
          }}>
            <span>$1</span><span>$1K</span><span>$1M</span><span>$1B</span>
          </div>
        </FilterRow>
        <FilterRow label={p.mcapCeiling < 9 ? `MCap ceiling  ≤ $${fmtFloor(p.mcapCeiling)}` : "MCap ceiling  · OFF"}>
          <input type="range" min="0" max="9" step="0.1"
            value={p.mcapCeiling}
            onChange={(e) => {
              const v = Number(e.target.value);
              p.setCeiling(v);
              if (v <= p.mcapFloor) p.setFloor(Math.max(0, v - 0.1));
            }}
            style={{ width: "100%", accentColor: "var(--amber)" }} />
          <div style={{
            display: "flex", justifyContent: "space-between",
            fontFamily: "var(--font-mono)", fontSize: 8,
            color: "var(--paper-4)", marginTop: 2,
          }}>
            <span>$1</span><span>$1K</span><span>$1M</span><span>$1B</span>
          </div>
        </FilterRow>
        <div className="mono" style={{
          fontSize: 9, color: "var(--paper-3)", letterSpacing: "0.08em",
          padding: "6px 0", marginTop: 4,
          borderTop: "1px solid var(--line-soft)",
        }}>
          {p.filtered.length} OF {p.pool.length} MATCH
        </div>
      </RailSection>

      <RailSection title="Protocols">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {groups.length === 0 && <EmptyHint text="No tokens yet" />}
          {groups.map(([dex, v]) => {
            const pct = (v.mcap / totalMcap) * 100;
            const upRatio = v.ups / Math.max(v.count, 1);
            const on = p.protoFilter === dex;
            return (
              <button key={dex}
                onClick={() => p.setPF(on ? null : dex)}
                style={{
                  background: on ? "var(--ink-2)" : "transparent",
                  border: "1px solid",
                  borderColor: on ? "var(--amber)" : "transparent",
                  borderRadius: 3,
                  padding: "8px 8px",
                  textAlign: "left", cursor: "pointer",
                  display: "flex", flexDirection: "column", gap: 4,
                  transition: "background 120ms",
                }}
                onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = "var(--ink-2)"; }}
                onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span className="mono" style={{
                    fontSize: 11, fontWeight: 600,
                    color: dexColor(dex), letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}>{dex}</span>
                  <span className="mono" style={{ fontSize: 9, color: "var(--paper-3)" }}>
                    {v.count} · {pct.toFixed(1)}%
                  </span>
                </div>
                <div style={{
                  height: 4, background: "var(--ink-2)",
                  borderRadius: 2, overflow: "hidden", position: "relative",
                }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: dexColor(dex), opacity: 0.5 }} />
                  <div style={{
                    width: `${pct * upRatio}%`, height: "100%", background: "var(--buy)",
                    position: "absolute", top: 0, left: 0,
                  }} />
                </div>
                <div style={{
                  display: "flex", justifyContent: "space-between",
                  fontFamily: "var(--font-mono)", fontSize: 8,
                  color: "var(--paper-4)", letterSpacing: "0.08em",
                }}>
                  <span>{fmtMcap(v.mcap)}</span>
                  <span>{Math.round(upRatio * 100)}% UP</span>
                </div>
              </button>
            );
          })}
        </div>
      </RailSection>

      <RailSection title="Sectors" subtitle="Angular density">
        <SectorCompass tokens={p.pool} />
      </RailSection>
    </div>
  );
}
function BrandSection({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div style={{
      padding: "14px 18px 12px",
      borderBottom: "1px solid var(--line-soft)",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <SpoolGlyph size={20} />
      <span className="ser" style={{
        fontStyle: "italic", fontSize: 17, fontWeight: 500,
        color: "var(--paper)", letterSpacing: "-0.02em",
      }}>Trending</span>
      <div style={{ flex: 1 }} />
      <ModeToggle mode={mode} setMode={setMode} />
    </div>
  );
}

function RailSection({ title, subtitle, children }: { title?: string; subtitle?: string; children: ReactNode }) {
  const hasHeader = !!title || !!subtitle;
  return (
    <div style={{
      padding: "16px 18px",
      borderBottom: "1px solid var(--line-soft)",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      {hasHeader && (
        <div>
          {title && (
            <span className="mono eyebrow" style={{
              fontSize: 9, color: "var(--paper-4)", letterSpacing: "0.16em",
            }}>{title.toUpperCase()}</span>
          )}
          {subtitle && (
            <div className="ser" style={{
              fontSize: 16, fontStyle: "italic",
              color: "var(--paper)", marginTop: 3, lineHeight: 1.2,
            }}>{subtitle}</div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span className="mono eyebrow" style={{
        fontSize: 9, color: "var(--paper-3)", letterSpacing: "0.08em",
      }}>{label.toUpperCase()}</span>
      {children}
    </div>
  );
}
function SegToggle<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: Array<{ id: T; label: string; color: string }> }) {
  return (
    <div style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 3, overflow: "hidden" }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button key={o.id}
            onClick={() => onChange(o.id)}
            className="mono"
            style={{
              flex: 1, padding: "5px 0", fontSize: 9, letterSpacing: "0.12em",
              background: on ? o.color : "transparent",
              color: on ? "var(--ink-0)" : "var(--paper-3)",
              border: "none", borderRight: "1px solid var(--line)",
              cursor: "pointer", fontWeight: on ? 700 : 500,
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SectorCompass({ tokens }: { tokens: TrendingEntry[] }) {
  const sectors = useMemo(() => {
    const arr = Array(8).fill(0) as number[];
    tokens.forEach((t, i) => {
      const seedH = (t.mint || t.symbol || String(i)).split("")
        .reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
      const ang = seedH % 360;
      arr[Math.floor(ang / 45) % 8] += 1;
    });
    return arr;
  }, [tokens]);
  const max = Math.max(...sectors, 1);
  const cx = 70, cy = 70, r = 56;
  return (
    <svg width="100%" viewBox="0 0 140 140" style={{ display: "block" }}>
      {[0.33, 0.66, 1].map((s, i) => (
        <circle key={i} cx={cx} cy={cy} r={r * s} fill="none" stroke="var(--line-soft)" strokeWidth="0.5" />
      ))}
      {sectors.map((v, i) => {
        const a0 = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const a1 = ((i + 1) / 8) * Math.PI * 2 - Math.PI / 2;
        const rr = (v / max) * r * 0.95;
        const x0 = cx + Math.cos(a0) * rr, y0 = cy + Math.sin(a0) * rr;
        const x1 = cx + Math.cos(a1) * rr, y1 = cy + Math.sin(a1) * rr;
        const path = `M ${cx} ${cy} L ${x0} ${y0} A ${rr} ${rr} 0 0 1 ${x1} ${y1} Z`;
        return <path key={i} d={path}
          fill="var(--amber)" opacity={0.15 + (v / max) * 0.6}
          stroke="var(--ink-1)" strokeWidth="1" />;
      })}
      {["N", "E", "S", "W"].map((c, i) => {
        const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
        const lx = cx + Math.cos(a) * (r + 8);
        const ly = cy + Math.sin(a) * (r + 8);
        return (
          <g key={c}>
            <line x1={cx} y1={cy} x2={cx + Math.cos(a) * r} y2={cy + Math.sin(a) * r}
              stroke="var(--line-soft)" strokeWidth="0.5" />
            <text x={lx} y={ly + 3} textAnchor="middle"
              fontFamily="var(--font-mono)" fontSize="8"
              fill="var(--paper-4)" letterSpacing="0.1em">{c}</text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="2" fill="var(--amber)" />
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// viewport dispatcher
// ════════════════════════════════════════════════════════════════════════════
interface ViewportProps {
  isMobile?: boolean;
  mode: Mode;
  tokens: TrendingEntry[];
  loading: boolean;
  pinned: string[];
  togglePin: (mint: string) => void;
  selectedMint: string | null;
  setSel: (mint: string | null) => void;
  openToken: (mint: string) => void;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
}
function Viewport(p: ViewportProps) {
  return (
    <div style={{
      position: "relative", background: "var(--ink-0)",
      overflow: "hidden", minHeight: 0,
      // Stacked on mobile the viewport has no 1fr row to fill, so give it a
      // tall fixed band; orbit/heat measure this via ResizeObserver and the
      // grid mode scrolls inside it.
      height: p.isMobile ? "72dvh" : undefined,
    }}>
      {p.loading && p.tokens.length === 0 && <BootingState />}
      {!p.loading && p.tokens.length === 0 && <EmptyState />}
      {p.tokens.length > 0 && p.mode === "orbit" && (
        <OrbitMode isMobile={p.isMobile} tokens={p.tokens} pinned={p.pinned} togglePin={p.togglePin}
          selectedMint={p.selectedMint} setSel={p.setSel} openToken={p.openToken}
          zoom={p.zoom} setZoom={p.setZoom} />
      )}
      {p.tokens.length > 0 && p.mode === "grid" && (
        <GridMode isMobile={p.isMobile} tokens={p.tokens} setSel={p.setSel} openToken={p.openToken}
          pinned={p.pinned} togglePin={p.togglePin} />
      )}
      {p.tokens.length > 0 && p.mode === "heat" && (
        <HeatMode isMobile={p.isMobile} tokens={p.tokens} setSel={p.setSel} openToken={p.openToken} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// orbit mode
// ════════════════════════════════════════════════════════════════════════════

const ORBIT_RING_COLORS = [
  "var(--amber)",
  "var(--accent)",
  "var(--buy)",
  "var(--paper-3)",
] as const;

/** Max visible tokens per ring — prevents the outer-ring pile-up. */
const ORBIT_RING_CAP = [8, 12, 16, 20] as const;

function orbitPickRingTokens(
  bucket: TrendingEntry[],
  cap: number,
  pinned: ReadonlySet<string>,
): { shown: TrendingEntry[]; hidden: number } {
  if (bucket.length <= cap) return { shown: bucket, hidden: 0 };
  const pinnedIn = bucket.filter((t) => pinned.has(t.mint));
  const rest = bucket
    .filter((t) => !pinned.has(t.mint))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const slots = Math.max(0, cap - pinnedIn.length);
  const seen = new Set<string>();
  const shown: TrendingEntry[] = [];
  for (const t of [...pinnedIn, ...rest.slice(0, slots)]) {
    if (seen.has(t.mint)) continue;
    seen.add(t.mint);
    shown.push(t);
  }
  return { shown, hidden: bucket.length - shown.length };
}

function OrbitBackdrop() {
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: `
        radial-gradient(ellipse 80% 65% at 50% 48%, color-mix(in oklch, var(--ink-1) 90%, black) 0%, var(--ink-0) 70%),
        var(--ink-0)
      `,
    }} />
  );
}

function OrbitGlass({
  children,
  style,
}: {
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      background: "color-mix(in oklch, var(--ink-1) 72%, transparent)",
      border: "1px solid color-mix(in oklch, var(--line-soft) 85%, transparent)",
      borderRadius: 8,
      backdropFilter: "blur(14px)",
      WebkitBackdropFilter: "blur(14px)",
      boxShadow: "0 12px 40px color-mix(in oklch, black 45%, transparent), inset 0 1px 0 color-mix(in oklch, white 6%, transparent)",
      ...style,
    }}>
      {children}
    </div>
  );
}

function OrbitChip({
  children,
  onClick,
  disabled,
  title,
  active,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="mono tap-target"
      style={{
        padding: "0 12px",
        height: 28,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        fontSize: 10,
        letterSpacing: "0.1em",
        fontWeight: 600,
        background: active
          ? "color-mix(in oklch, var(--accent) 18%, transparent)"
          : "transparent",
        border: "none",
        borderRadius: 6,
        color: disabled
          ? "var(--paper-4)"
          : active ? "var(--paper)" : "var(--paper-2)",
        cursor: disabled ? "default" : "pointer",
        transition: "background 120ms ease, color 120ms ease",
        // Touch/keyboard affordance: visible focus ring (orbit controls were
        // mouse-hover only). preventDefault on the wheel handler keeps zoom.
        outlineColor: "var(--accent)",
        outlineOffset: 1,
      }}
      onFocus={(e) => { e.currentTarget.style.outline = "2px solid var(--accent)"; }}
      onBlur={(e) => { e.currentTarget.style.outline = "none"; }}
    >
      {children}
    </button>
  );
}

interface OrbitProps {
  isMobile?: boolean;
  tokens: TrendingEntry[];
  pinned: string[];
  togglePin: (mint: string) => void;
  selectedMint: string | null;
  setSel: (mint: string | null) => void;
  openToken: (mint: string) => void;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
}
function OrbitMode(p: OrbitProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [t, setT] = useState(0);
  const [hoverMint, setHoverMint] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (paused) return;
    let raf = 0;
    let last = performance.now();
    let hidden = document.hidden;
    // Throttle to ~24fps (42ms) — orbital animation is slow enough that
    // 60fps is wasted work, and it blocks the main thread during
    // navigation transitions causing the "stuck page" effect.
    const FRAME_BUDGET = 42;
    const tick = (now: number) => {
      if (hidden) { raf = requestAnimationFrame(tick); return; }
      const elapsed = now - last;
      if (elapsed >= FRAME_BUDGET) {
        const dt = elapsed / 1000; last = now;
        setT((prev) => prev + dt);
      }
      raf = requestAnimationFrame(tick);
    };
    const onVis = () => { hidden = document.hidden; };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [paused]);

  const cx = size.w / 2, cy = size.h / 2;
  const maxR = Math.max(70, Math.min(size.w, size.h) / 2 - 50);
  // Visible rings = the first `zoom` entries of the global ladder. Radii
  // distribute outward, leaving a gap at the centre for the SOL core and a
  // small margin at the edge so the outer dots don't kiss the viewport.
  const visibleRings = useMemo(() => RING_LADDER.slice(0, p.zoom), [p.zoom]);
  const ringCount = visibleRings.length;
  const ringRadii = useMemo(
    () => visibleRings.map((_, i) => maxR * (0.34 + (0.54 * (i + (ringCount === 1 ? 0.5 : 0))) / Math.max(1, ringCount - 1))),
    [visibleRings, maxR, ringCount],
  );
  const coreR = Math.max(22, maxR * 0.08);
  const pinnedSet = useMemo(() => new Set(p.pinned), [p.pinned]);

  const maxScore = Math.max(...p.tokens.map((tt) => tt.score ?? 0), 1);

  // Bucket by age ring, cap visible count per ring, evenly space slots.
  const { ringShown, ringHidden, olderCount } = useMemo(() => {
    const raw: TrendingEntry[][] = visibleRings.map(() => []);
    const outerBound = visibleRings.length
      ? visibleRings[visibleRings.length - 1].minutes
      : Infinity;
    let older = 0;
    p.tokens.forEach((tok) => {
      const ageMin = (Date.now() - tok.createdAt) / 60000;
      if (ageMin >= outerBound) { older += 1; return; }
      for (let i = 0; i < visibleRings.length; i++) {
        if (ageMin < visibleRings[i].minutes) { raw[i].push(tok); break; }
      }
    });
    const shown: TrendingEntry[][] = [];
    const hidden: number[] = [];
    raw.forEach((bucket, i) => {
      const cap = ORBIT_RING_CAP[Math.min(i, ORBIT_RING_CAP.length - 1)];
      const pick = orbitPickRingTokens(bucket, cap, pinnedSet);
      shown.push(pick.shown);
      hidden.push(pick.hidden);
    });
    return { ringShown: shown, ringHidden: hidden, olderCount: older };
  }, [p.tokens, visibleRings, pinnedSet]);

  const placed = useMemo(() => {
    const out: Array<{
      tok: TrendingEntry;
      x: number; y: number; radius: number;
      ringIdx: number; up: boolean;
      ang: number; dir: number; isPinned: boolean; ageMin: number;
      scoreNorm: number; pct: number; hot: boolean;
    }> = [];
    const now = Date.now();
    for (let ri = 0; ri < ringCount; ri++) {
      const bucket = ringShown[ri];
      const n = bucket.length;
      if (n === 0) continue;
      const r = ringRadii[ri];
      const dir = ri % 2 === 0 ? 1 : -1;
      const drift = t * 0.006 * dir;
      bucket.forEach((tok, i) => {
        const slotAngle = (i / n) * Math.PI * 2 - Math.PI / 2 + ri * 0.35;
        const ang = slotAngle + drift;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        const scoreNorm = Math.min(1, (tok.score ?? 0) / maxScore);
        const radius = 9 + scoreNorm * 5;
        const pct = tok.priceChangePct ?? 0;
        out.push({
          tok, x, y, radius, ringIdx: ri,
          up: pct >= 0, ang, dir,
          isPinned: pinnedSet.has(tok.mint),
          ageMin: (now - tok.createdAt) / 60000,
          scoreNorm, pct,
          hot: now - tok.lastEventAt < 2200,
        });
      });
    }
    return out;
  }, [ringShown, t, cx, cy, ringRadii, ringCount, maxScore, pinnedSet]);

  const ringCounts = useMemo(() => ringShown.map((b) => b.length), [ringShown]);

  const handleClick = (mint: string, e: React.MouseEvent) => {
    if (e.shiftKey) p.togglePin(mint);
    else p.setSel(mint);
  };
  const handleDoubleClick = (mint: string) => p.openToken(mint);

  const hovered = hoverMint ? placed.find((pp) => pp.tok.mint === hoverMint) : null;

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) < 4) return; // ignore micro-scrolls
    e.preventDefault();
    p.setZoom((z) => {
      const next = e.deltaY > 0 ? z + 1 : z - 1;
      return Math.max(MIN_RINGS, Math.min(MAX_RINGS, next));
    });
  };

  return (
    <div ref={wrapRef}
      onWheel={onWheel}
      style={{
        position: "absolute", inset: 0, overflow: "hidden",
        // The page itself becomes scrollable on mobile (`.app-scroll`); keep
        // the wheel/trackpad gesture here trapped to ring-zoom (the handler
        // preventDefaults) and stop it chaining to the page scroll.
        overscrollBehavior: "contain",
        touchAction: p.isMobile ? "pan-y" : undefined,
      }}>
      <OrbitBackdrop />

      <svg width={size.w} height={size.h} style={{ position: "absolute", inset: 0 }}>
        <defs>
          {placed.map((pp) => (
            <clipPath key={pp.tok.mint} id={`tok-clip-${pp.tok.mint}`}>
              <circle cx={pp.x} cy={pp.y} r={pp.radius} />
            </clipPath>
          ))}
        </defs>

        {ringRadii.map((r, i) => (
          <circle key={`ring-${i}`}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={ORBIT_RING_COLORS[i % ORBIT_RING_COLORS.length]}
            strokeWidth="1"
            strokeOpacity="0.22"
          />
        ))}

        {/* Minimal live hub */}
        <circle cx={cx} cy={cy} r={coreR * 1.8}
          fill="color-mix(in oklch, var(--amber) 12%, transparent)" />
        <circle cx={cx} cy={cy} r={coreR}
          fill="var(--ink-2)"
          stroke="var(--amber)"
          strokeWidth="1.5"
          strokeOpacity="0.7"
        />
        <circle cx={cx} cy={cy} r={3} fill="var(--amber)" opacity="0.9">
          <animate attributeName="opacity" values="0.5;1;0.5" dur="2.4s" repeatCount="indefinite" />
        </circle>

        {placed.map((pp) => {
          const isHover = hoverMint === pp.tok.mint;
          const isSel = p.selectedMint === pp.tok.mint;
          const showLabel = isHover || isSel || pp.isPinned;
          const accent = pp.up ? "var(--buy)" : "var(--sell)";
          const stroke = isSel ? "var(--amber)"
            : isHover ? "var(--paper)"
              : pp.isPinned ? "var(--amber)"
                : `color-mix(in oklch, ${accent} 70%, var(--line-soft))`;
          return (
            <g key={pp.tok.mint}
              onMouseEnter={() => setHoverMint(pp.tok.mint)}
              onMouseLeave={() => setHoverMint((h) => (h === pp.tok.mint ? null : h))}
              onClick={(e) => handleClick(pp.tok.mint, e)}
              onDoubleClick={() => handleDoubleClick(pp.tok.mint)}
              style={{ cursor: "pointer" }}>
              {(isHover || isSel) && (
                <circle cx={pp.x} cy={pp.y} r={pp.radius + 8}
                  fill="none" stroke={stroke} strokeWidth="1" opacity="0.35" />
              )}
              <circle cx={pp.x} cy={pp.y} r={pp.radius + 1.5}
                fill="var(--ink-0)" opacity="0.85" />
              <circle cx={pp.x} cy={pp.y} r={pp.radius}
                fill={pp.tok.image ? "var(--ink-2)" : accent}
                opacity={0.95} />
              {pp.tok.image && (
                <image
                  href={pp.tok.image}
                  x={pp.x - pp.radius} y={pp.y - pp.radius}
                  width={pp.radius * 2} height={pp.radius * 2}
                  clipPath={`url(#tok-clip-${pp.tok.mint})`}
                  preserveAspectRatio="xMidYMid slice"
                />
              )}
              <circle cx={pp.x} cy={pp.y} r={pp.radius}
                fill="none" stroke={stroke}
                strokeWidth={isSel || isHover ? 2 : 1.5}
              />
              {pp.hot && (
                <circle cx={pp.x} cy={pp.y} r={pp.radius + 4}
                  fill="none" stroke={accent} strokeWidth="1" opacity="0.6">
                  <animate attributeName="r"
                    from={pp.radius + 3} to={pp.radius + 10}
                    dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="stroke-opacity"
                    from="0.6" to="0" dur="1.8s" repeatCount="indefinite" />
                </circle>
              )}
              {showLabel && pp.tok.symbol && (
                <text x={pp.x} y={pp.y - pp.radius - 8} textAnchor="middle"
                  fontFamily="var(--font-mono)" fontSize={10} fontWeight="600"
                  fill="var(--paper)"
                  style={{
                    paintOrder: "stroke",
                    stroke: "var(--ink-0)", strokeWidth: 4, strokeLinejoin: "round",
                  }}>
                  {pp.tok.symbol}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hovered && (
        <HoverCard p={hovered} containerW={size.w} containerH={size.h} />
      )}

      <OrbitGlass style={{
        position: "absolute", left: 16, top: 16,
        padding: "10px 12px",
        pointerEvents: "none",
        minWidth: 168,
      }}>
        <div className="mono eyebrow" style={{
          fontSize: 8, color: "var(--paper-4)", letterSpacing: "0.16em",
          marginBottom: 8,
        }}>AGE RINGS · TOP BY SCORE</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {visibleRings.map((tier, i) => {
            const prev = i === 0 ? "0" : visibleRings[i - 1].label;
            const range = i === 0 ? `< ${tier.label}` : `${prev} – ${tier.label}`;
            const color = ORBIT_RING_COLORS[i % ORBIT_RING_COLORS.length];
            const hidden = ringHidden[i] ?? 0;
            return (
              <div key={tier.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: color,
                  opacity: 0.85,
                  flexShrink: 0,
                }} />
                <span className="mono" style={{
                  fontSize: 9, color: "var(--paper-3)", letterSpacing: "0.08em",
                  minWidth: 72,
                }}>{range}</span>
                <span className="mono" style={{
                  fontSize: 10, color: "var(--paper)", fontWeight: 700,
                  marginLeft: "auto",
                }}>
                  {ringCounts[i] ?? 0}
                  {hidden > 0 && (
                    <span style={{ color: "var(--paper-4)", fontWeight: 500 }}>
                      {` +${hidden}`}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
          {olderCount > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              paddingTop: 4,
              borderTop: "1px solid color-mix(in oklch, var(--line-soft) 70%, transparent)",
            }}>
              <span style={{ width: 8 }} />
              <span className="mono" style={{ fontSize: 9, color: "var(--paper-4)", minWidth: 72 }}>+ older</span>
              <span className="mono" style={{ fontSize: 10, color: "var(--paper-3)", fontWeight: 700, marginLeft: "auto" }}>
                {olderCount}
              </span>
            </div>
          )}
        </div>
      </OrbitGlass>

      <OrbitGlass style={{
        position: "absolute", left: "50%", bottom: 18,
        transform: "translateX(-50%)",
        display: "flex", alignItems: "stretch",
        overflow: "hidden",
        pointerEvents: "auto",
        maxWidth: viewportMaxWidth(),
      }}>
        <OrbitChip onClick={() => setPaused((v) => !v)} active={paused} title={paused ? "Resume orbit" : "Pause orbit"}>
          {paused ? "▷ RESUME" : "❚❚ PAUSE"}
        </OrbitChip>
        <div style={{ width: 1, background: "var(--line-soft)", margin: "6px 0" }} />
        <OrbitChip
          onClick={() => p.setZoom((z) => Math.max(MIN_RINGS, z - 1))}
          disabled={p.zoom <= MIN_RINGS}
          title="Zoom in (fewer rings)"
        >−</OrbitChip>
        <span className="mono" style={{
          display: "flex", alignItems: "center",
          padding: "0 10px", fontSize: 10, letterSpacing: "0.1em",
          color: "var(--paper-2)", fontWeight: 600,
          borderLeft: "1px solid var(--line-soft)",
          borderRight: "1px solid var(--line-soft)",
        }}>
          {p.zoom}/{MAX_RINGS}
        </span>
        <OrbitChip
          onClick={() => p.setZoom((z) => Math.min(MAX_RINGS, z + 1))}
          disabled={p.zoom >= MAX_RINGS}
          title="Zoom out (more rings)"
        >+</OrbitChip>
        <div className="hide-mobile" style={{ width: 1, background: "var(--line-soft)", margin: "6px 0" }} />
        <span className="mono hide-mobile" style={{
          display: "flex", alignItems: "center",
          padding: "0 12px", fontSize: 9, letterSpacing: "0.08em",
          color: "var(--paper-4)",
        }}>
          SCROLL TO ZOOM
        </span>
      </OrbitGlass>

      <div className="hide-mobile" style={{
        position: "absolute", right: 16, top: 16,
        pointerEvents: "none",
      }}>
        <OrbitGlass style={{ padding: "8px 12px" }}>
          <div className="mono" style={{
            fontSize: 9, color: "var(--paper-3)", letterSpacing: "0.1em", lineHeight: 1.6,
          }}>
            <div><span style={{ color: "var(--paper-4)" }}>CLICK</span> inspect</div>
            <div><span style={{ color: "var(--paper-4)" }}>SHIFT</span> pin</div>
            <div><span style={{ color: "var(--paper-4)" }}>DBL</span> open</div>
          </div>
        </OrbitGlass>
      </div>
    </div>
  );
}

interface PlacedToken {
  tok: TrendingEntry;
  x: number; y: number; radius: number;
  ringIdx: number; up: boolean;
  ang: number; dir: number; isPinned: boolean; ageMin: number;
}
function HoverCard({ p, containerW, containerH }: { p: PlacedToken; containerW: number; containerH: number }) {
  const isMobile = useIsMobile();
  const CARD_W = 196;
  const preferred = p.x > containerW / 2 ? p.x - (CARD_W + 14) : p.x + p.radius + 16;
  // Keep the card inside the viewport on narrow screens (it had a fixed 196px
  // width + absolute JS left and could spill off the right edge on phones).
  // Desktop keeps the original unclamped placement (byte-identical); the narrow
  // orbit column would otherwise shift the card on sub-1080px desktop widths.
  const left = isMobile ? Math.max(8, Math.min(containerW - CARD_W - 8, preferred)) : preferred;
  const top = Math.max(10, Math.min(containerH - 140, p.y - 36));
  const accent = p.up ? "var(--buy)" : "var(--sell)";
  return (
    <OrbitGlass style={{
      position: "absolute", left, top,
      width: CARD_W, maxWidth: viewportMaxWidth(), padding: "12px 14px",
      pointerEvents: "none", zIndex: 4,
      borderColor: `color-mix(in oklch, ${accent} 35%, var(--line-soft))`,
      boxShadow: `0 16px 48px color-mix(in oklch, black 50%, transparent), 0 0 0 1px color-mix(in oklch, ${accent} 12%, transparent)`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        {p.tok.image ? (
          <img src={p.tok.image} alt="" style={{
            width: 28, height: 28, borderRadius: "50%",
            objectFit: "cover", border: `1.5px solid ${accent}`,
          }} />
        ) : (
          <span style={{
            width: 28, height: 28, borderRadius: "50%",
            background: accent, display: "inline-flex",
            alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 700, color: "var(--ink-0)",
          }}>
            {(p.tok.symbol || "?").slice(0, 1)}
          </span>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--paper)" }}>
            {p.tok.symbol || shortAddr(p.tok.mint, 3)}
          </div>
          <div className="ellipsis" style={{ fontSize: 10, color: "var(--paper-3)" }}>{p.tok.name}</div>
        </div>
        <span className="mono" style={{
          fontSize: 10, fontWeight: 700, color: accent,
        }}>
          {(p.tok.priceChangePct ?? 0) >= 0 ? "+" : ""}{(p.tok.priceChangePct ?? 0).toFixed(1)}%
        </span>
      </div>
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
        paddingTop: 8,
        borderTop: "1px solid color-mix(in oklch, var(--line-soft) 75%, transparent)",
      }}>
        <KVCell k="MCAP" v={fmtMcap(p.tok.marketCap)} />
        <KVCell k="DEX" v={(p.tok.dex || "–").toUpperCase()} />
        <KVCell k="AGE" v={fmtAge(p.ageMin)} />
        <KVCell k="SCORE" v={(p.tok.score ?? 0).toFixed(1)} />
      </div>
    </OrbitGlass>
  );
}
function KVCell({ k, v, tone }: { k: string; v: ReactNode; tone?: "buy" | "sell" }) {
  const color = tone === "buy" ? "var(--buy)" : tone === "sell" ? "var(--sell)" : "var(--paper)";
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span className="mono eyebrow" style={{ fontSize: 7, color: "var(--paper-4)", letterSpacing: "0.12em" }}>{k}</span>
      <span className="mono" style={{ fontSize: 10, fontWeight: 600, color }}>{v}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// grid mode
// ════════════════════════════════════════════════════════════════════════════
interface GridProps {
  isMobile?: boolean;
  tokens: TrendingEntry[];
  setSel: (m: string | null) => void;
  openToken: (m: string) => void;
  pinned: string[];
  togglePin: (m: string) => void;
}
function GridMode(p: GridProps) {
  const sorted = useMemo(() => [...p.tokens].sort((a, b) => b.score - a.score), [p.tokens]);
  return (
    <div className={p.isMobile ? "app-scroll" : undefined} style={{
      position: "absolute", inset: 0, overflow: "auto", padding: p.isMobile ? 12 : 18,
      display: "grid",
      // fluidColsFit never overflows on phones (cards collapse to full row
      // below their min); desktop keeps the 180px-min look via the wider min.
      gridTemplateColumns: p.isMobile ? fluidColsFit(140) : "repeat(auto-fill, minmax(180px, 1fr))",
      gap: 10, alignContent: "start",
    }}>
      {sorted.map((t) => {
        const up = (t.priceChangePct ?? 0) >= 0;
        const isPinned = p.pinned.includes(t.mint);
        const ageMin = (Date.now() - t.createdAt) / 60000;
        return (
          <div key={t.mint}
            onClick={() => p.setSel(t.mint)}
            onDoubleClick={() => p.openToken(t.mint)}
            style={{
              padding: "10px 12px", cursor: "pointer",
              background: "var(--ink-1)",
              border: "1px solid",
              borderColor: isPinned ? "var(--amber)" : "var(--line-soft)",
              borderRadius: 3,
              transition: "border-color 120ms",
              display: "flex", flexDirection: "column", gap: 6,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--paper-3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = isPinned ? "var(--amber)" : "var(--line-soft)"; }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: up ? "var(--buy)" : "var(--sell)",
                display: "inline-block",
              }} />
              <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--paper)" }}>{t.symbol || shortAddr(t.mint, 3)}</span>
              <span className="ellipsis" style={{ fontSize: 10, color: "var(--paper-3)", flex: 1 }}>{t.name}</span>
              <button onClick={(e) => { e.stopPropagation(); p.togglePin(t.mint); }}
                title={isPinned ? "Unpin" : "Pin"}
                className="tap-target"
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  color: isPinned ? "var(--amber)" : "var(--paper-4)", fontSize: 10, padding: 0,
                }}>{isPinned ? "●" : "○"}</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <KVCell k="MCAP" v={fmtMcap(t.marketCap)} />
              <KVCell k="Δ%" v={`${(t.priceChangePct ?? 0).toFixed(1)}%`} tone={up ? "buy" : "sell"} />
              <KVCell k="DEX" v={(t.dex || "–").toUpperCase()} />
              <KVCell k="AGE" v={fmtAge(ageMin)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// heat mode (squarified treemap, weighted by mcap, colored by Δ%)
// ════════════════════════════════════════════════════════════════════════════
interface HeatProps {
  isMobile?: boolean;
  tokens: TrendingEntry[];
  setSel: (m: string | null) => void;
  openToken: (m: string) => void;
}
function HeatMode(p: HeatProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  useLayoutEffect(() => {
    const measure = () => {
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const rects = useMemo(() => {
    const items = [...p.tokens]
      .filter((t) => (t.marketCap ?? 0) > 0)
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    const total = items.reduce((s, t) => s + (t.marketCap ?? 0), 0) || 1;
    const W = size.w - 24, H = size.h - 24;
    const area = W * H;
    const out: Array<{ tok: TrendingEntry; x: number; y: number; w: number; h: number }> = [];
    let y = 12;
    let row: TrendingEntry[] = [];
    let rowW = 0;
    const targetRowH = Math.sqrt(area / Math.max(items.length, 1)) * 0.9;
    const flushRow = () => {
      const rowMcap = row.reduce((s, t) => s + (t.marketCap ?? 0), 0);
      const rowArea = (rowMcap / total) * area;
      const h = Math.min(H - (y - 12), Math.max(targetRowH, rowArea / W));
      let cx2 = 12;
      row.forEach((t) => {
        const w = ((t.marketCap ?? 0) / Math.max(rowMcap, 1)) * W;
        out.push({ tok: t, x: cx2, y, w: Math.max(w - 2, 4), h: Math.max(h - 2, 4) });
        cx2 += w;
      });
      y += h; row = []; rowW = 0;
    };
    items.forEach((t) => {
      const tArea = ((t.marketCap ?? 0) / total) * area;
      row.push(t);
      rowW += tArea;
      if (rowW / W >= targetRowH * 0.7 || y >= H) flushRow();
    });
    if (row.length) flushRow();
    return out;
  }, [p.tokens, size]);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
      <svg width={size.w} height={size.h}>
        {rects.map((r) => {
          const t = r.tok;
          const ch = t.priceChangePct ?? 0;
          const intensity = Math.min(Math.abs(ch) / 30, 1);
          const fill = ch >= 0
            ? `color-mix(in oklch, var(--buy) ${20 + intensity * 70}%, var(--ink-1))`
            : `color-mix(in oklch, var(--sell) ${20 + intensity * 70}%, var(--ink-1))`;
          return (
            <g key={t.mint}
              onClick={() => p.setSel(t.mint)}
              onDoubleClick={() => p.openToken(t.mint)}
              style={{ cursor: "pointer" }}>
              <rect x={r.x} y={r.y} width={r.w} height={r.h}
                fill={fill}
                stroke="var(--ink-0)" strokeWidth="1" />
              {r.w > 60 && r.h > 28 && (
                <>
                  <text x={r.x + 7} y={r.y + 16}
                    fontFamily="var(--font-mono)" fontSize={Math.min(13, Math.max(10, r.w / 12))}
                    fontWeight="700" fill="var(--paper)">{t.symbol || shortAddr(t.mint, 3)}</text>
                  <text x={r.x + 7} y={r.y + 30}
                    fontFamily="var(--font-mono)" fontSize="10"
                    fill="var(--paper-2)">{ch >= 0 ? "+" : ""}{ch.toFixed(1)}%</text>
                </>
              )}
              {r.w > 100 && r.h > 50 && (
                <text x={r.x + 7} y={r.y + r.h - 8}
                  fontFamily="var(--font-mono)" fontSize="9"
                  fill="var(--paper-3)">{fmtMcap(t.marketCap)}</text>
              )}
            </g>
          );
        })}
      </svg>
      <div style={{
        position: "absolute", left: 14, bottom: 14,
        padding: "8px 10px",
        background: "color-mix(in oklch, var(--ink-1) 80%, transparent)",
        border: "1px solid var(--line-soft)", borderRadius: 3,
        backdropFilter: "blur(6px)",
        display: "flex", flexDirection: "column", gap: 4,
      }}>
        <span className="mono eyebrow" style={{ fontSize: 8, color: "var(--paper-4)", letterSpacing: "0.14em" }}>HEAT · Δ%</span>
        <div style={{ display: "flex", height: 10, width: p.isMobile ? "max(100px, min(180px, calc(100vw - 56px)))" : 180 }}>
          {[-30, -20, -10, 0, 10, 20, 30].map((v) => {
            const fill = v >= 0
              ? `color-mix(in oklch, var(--buy) ${20 + Math.min(Math.abs(v) / 30, 1) * 70}%, var(--ink-1))`
              : `color-mix(in oklch, var(--sell) ${20 + Math.min(Math.abs(v) / 30, 1) * 70}%, var(--ink-1))`;
            return <div key={v} style={{ flex: 1, background: fill }} />;
          })}
        </div>
        <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "var(--paper-4)" }}>
          <span>-30%</span><span>0</span><span>+30%</span>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// inspector rail (right)
// ════════════════════════════════════════════════════════════════════════════
interface InspectorProps {
  isMobile?: boolean;
  token: TrendingEntry | null;
  events: RecentEvent[];
  openToken: (m: string) => void;
  isPinned: boolean;
  togglePin: (m: string) => void;
  isHidden: boolean;
  hideToken: (t: TrendingEntry) => void;
  unhideToken: (m: string) => void;
}
function InspectorRail(p: InspectorProps) {
  return (
    <div className={p.isMobile ? "app-scroll" : undefined} style={{
      background: "var(--ink-1)",
      display: "flex", flexDirection: "column",
      // Desktop: full-height fixed sidebar (clipped). Mobile: stacked block —
      // cap height and let it scroll so the inspector + ticker don't run off
      // the bottom of the stacked column.
      overflow: p.isMobile ? "auto" : "hidden", minHeight: 0,
      maxHeight: p.isMobile ? "64dvh" : undefined,
    }}>
      <TokenInspector
        token={p.token}
        isPinned={p.isPinned} togglePin={p.togglePin}
        isHidden={p.isHidden}
        hideToken={p.hideToken} unhideToken={p.unhideToken}
        openToken={p.openToken}
      />
      <EventTicker events={p.events} openToken={p.openToken} />
    </div>
  );
}


function TokenInspector({
  token, isPinned, togglePin, isHidden, hideToken, unhideToken, openToken,
}: {
  token: TrendingEntry | null;
  isPinned: boolean; togglePin: (m: string) => void;
  isHidden: boolean;
  hideToken: (t: TrendingEntry) => void; unhideToken: (m: string) => void;
  openToken: (m: string) => void;
}) {
  if (!token) {
    return (
      <div style={{
        padding: "20px 18px", borderBottom: "1px solid var(--line-soft)",
        display: "flex", flexDirection: "column", gap: 8,
      }}>
        <span className="mono eyebrow" style={{ fontSize: 9, color: "var(--paper-4)", letterSpacing: "0.16em" }}>INSPECTOR</span>
        <div className="ser" style={{ fontStyle: "italic", fontSize: 16, color: "var(--paper-3)", lineHeight: 1.3 }}>
          Pick a token from the constellation
        </div>
        <span className="mono" style={{ fontSize: 9, color: "var(--paper-4)", letterSpacing: "0.08em", marginTop: 4 }}>
          CLICK · INSPECT  ·  SHIFT · PIN  ·  DBL · OPEN
        </span>
      </div>
    );
  }
  const up = (token.priceChangePct ?? 0) >= 0;
  const ageMin = (Date.now() - token.createdAt) / 60000;
  const buyRatio = token.tradeCount > 0
    ? token.buyCount / token.tradeCount
    : 0.5;

  return (
    <div style={{
      padding: "16px 18px", borderBottom: "1px solid var(--line-soft)",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span className="mono eyebrow" style={{ fontSize: 9, color: "var(--paper-4)", letterSpacing: "0.16em" }}>INSPECTOR</span>
        <span className="mono" style={{
          fontSize: 8, color: up ? "var(--buy)" : "var(--sell)",
          letterSpacing: "0.14em",
        }}>{up ? "▲ POSITIVE" : "▼ NEGATIVE"}</span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--paper)" }}>{token.symbol || shortAddr(token.mint, 3)}</span>
        <span className="ellipsis ser" style={{
          fontStyle: "italic", fontSize: 13, color: "var(--paper-3)", flex: 1,
        }}>{token.name}</span>
      </div>

      {(token.isNew || token.isMigrating) && (
        <div style={{ display: "flex", gap: 6 }}>
          {token.isNew && <Badge color="var(--amber)">FRESH</Badge>}
          {token.isMigrating && <Badge color="var(--paper)">MIGRATING</Badge>}
        </div>
      )}

      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
        padding: "10px 0",
        borderTop: "1px solid var(--line-soft)",
        borderBottom: "1px solid var(--line-soft)",
      }}>
        <KVCell k="MARKET CAP" v={fmtMcap(token.marketCap)} />
        <KVCell k="Δ% SINCE SEEN" v={`${up ? "+" : ""}${(token.priceChangePct ?? 0).toFixed(2)}%`} tone={up ? "buy" : "sell"} />
        <KVCell k="PROTOCOL" v={(token.dex || "–").toUpperCase()} />
        <KVCell k="AGE" v={fmtAge(ageMin)} />
        <KVCell k="VOLUME" v={`${token.volumeSol.toFixed(2)} SOL`} />
        <KVCell k="TRADERS" v={String(token.uniqueTraders)} />
      </div>

      {/* buy/sell pressure bar */}
      <div>
        <div style={{
          display: "flex", justifyContent: "space-between",
          fontFamily: "var(--font-mono)", fontSize: 8,
          color: "var(--paper-4)", letterSpacing: "0.12em",
          marginBottom: 4,
        }}>
          <span>BUY · {token.buyCount}</span>
          <span>{token.tradeCount} TRADES</span>
          <span>SELL · {token.sellCount}</span>
        </div>
        <div style={{
          height: 5, background: "var(--ink-2)",
          borderRadius: 2, overflow: "hidden", display: "flex",
        }}>
          <div style={{ width: `${buyRatio * 100}%`, background: "var(--buy)" }} />
          <div style={{ flex: 1, background: "var(--sell)" }} />
        </div>
      </div>

      <Sparkline up={up} change={token.priceChangePct ?? 0} />

      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 9,
        color: "var(--paper-4)", letterSpacing: "0.04em",
        wordBreak: "break-all", lineHeight: 1.4,
      }}>
        {token.mint}
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <ActionBtn onClick={() => togglePin(token.mint)} accent={isPinned}>
          {isPinned ? "● PINNED" : "○ PIN"}
        </ActionBtn>
        <ActionBtn
          onClick={() => (isHidden ? unhideToken(token.mint) : hideToken(token))}
          accent={isHidden}
          title={isHidden ? "Show this token across all surfaces" : "Hide this token across all surfaces"}>
          {isHidden ? "◌ HIDDEN" : "⊘ HIDE"}
        </ActionBtn>
        <ActionBtn onClick={() => openToken(token.mint)} primary>
          OPEN →
        </ActionBtn>
      </div>
    </div>
  );
}

function Badge({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span className="mono" style={{
      padding: "2px 6px", fontSize: 8, letterSpacing: "0.16em", fontWeight: 700,
      color: "var(--ink-0)", background: color, borderRadius: 2,
    }}>{children}</span>
  );
}

function ActionBtn({
  children, onClick, accent, primary, title,
}: { children: ReactNode; onClick: () => void; accent?: boolean; primary?: boolean; title?: string }) {
  const bg = primary ? "var(--amber)" : accent ? "var(--amber)" : "transparent";
  const fg = primary || accent ? "var(--ink-0)" : "var(--paper-2)";
  return (
    <button onClick={onClick}
      title={title}
      className="mono"
      style={{
        flex: 1, padding: "7px 0", fontSize: 9, letterSpacing: "0.12em",
        background: bg, color: fg,
        border: `1px solid ${primary || accent ? "var(--amber)" : "var(--line)"}`,
        borderRadius: 3, cursor: "pointer", fontWeight: 700,
        transition: "background 100ms",
      }}>
      {children}
    </button>
  );
}

// Compact mock sparkline based on price change — just a directional shape.
function Sparkline({ up, change }: { up: boolean; change: number }) {
  const points = useMemo(() => {
    const N = 28;
    const arr: number[] = [];
    // Clamp to ±100 for visual purposes — early-life tokens routinely show
    // +4000% which would otherwise flatten the noise into a single ramp.
    const target = Math.max(-100, Math.min(100, change));
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const noise = (Math.sin(i * 1.7) + Math.cos(i * 0.9)) * 0.6;
      arr.push(target * t + noise * 4);
    }
    return arr;
  }, [change]);
  const min = Math.min(...points), max = Math.max(...points);
  const span = Math.max(0.001, max - min);
  const W = 280, H = 38;
  const path = points.map((v, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - ((v - min) / span) * H;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  const color = up ? "var(--buy)" : "var(--sell)";
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      style={{ display: "block", height: 38 }}>
      <path d={`${path} L ${W} ${H} L 0 ${H} Z`} fill={color} opacity="0.13" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.4" />
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// recent events ticker — derived from snapshot deltas
// ════════════════════════════════════════════════════════════════════════════
interface RecentEvent {
  id: string;
  kind: "deploy" | "migration" | "spike";
  mint: string;
  symbol: string;
  dex: string;
  pct?: number;
  ts: number;
}
function useRecentEvents(entries: TrendingEntry[]): RecentEvent[] {
  const [evts, setEvts] = useState<RecentEvent[]>([]);
  const seenRef = useRef<Map<string, { isNew: boolean; isMig: boolean; pct: number }>>(new Map());

  useEffect(() => {
    const seen = seenRef.current;
    const fresh: RecentEvent[] = [];
    const now = Date.now();
    for (const e of entries) {
      const prev = seen.get(e.mint);
      const pct = e.priceChangePct ?? 0;
      if (!prev) {
        if (e.isNew) {
          fresh.push({ id: `d-${e.mint}-${now}`, kind: "deploy", mint: e.mint, symbol: e.symbol, dex: e.dex, ts: e.lastEventAt });
        }
        if (e.isMigrating) {
          fresh.push({ id: `m-${e.mint}-${now}`, kind: "migration", mint: e.mint, symbol: e.symbol, dex: e.dex, ts: e.lastEventAt });
        }
      } else {
        if (e.isNew && !prev.isNew) {
          fresh.push({ id: `d-${e.mint}-${now}`, kind: "deploy", mint: e.mint, symbol: e.symbol, dex: e.dex, ts: e.lastEventAt });
        }
        if (e.isMigrating && !prev.isMig) {
          fresh.push({ id: `m-${e.mint}-${now}`, kind: "migration", mint: e.mint, symbol: e.symbol, dex: e.dex, ts: e.lastEventAt });
        }
        // Spike: large change since last observation
        if (Math.abs(pct - prev.pct) >= 15) {
          fresh.push({
            id: `s-${e.mint}-${now}`, kind: "spike", mint: e.mint, symbol: e.symbol,
            dex: e.dex, pct, ts: e.lastEventAt,
          });
        }
      }
      seen.set(e.mint, { isNew: e.isNew, isMig: e.isMigrating, pct });
    }
    if (fresh.length === 0) return;
    setEvts((prev) => [...fresh.reverse(), ...prev].slice(0, 60));
  }, [entries]);

  return evts;
}

function EventTicker({ events, openToken }: { events: RecentEvent[]; openToken: (m: string) => void }) {
  return (
    <div style={{
      flex: 1, minHeight: 0,
      padding: "14px 18px",
      display: "flex", flexDirection: "column", gap: 10,
      overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span className="mono eyebrow" style={{ fontSize: 9, color: "var(--paper-4)", letterSpacing: "0.16em" }}>EVENTS</span>
        <span className="mono" style={{ fontSize: 8, color: "var(--paper-4)", letterSpacing: "0.12em" }}>{events.length}</span>
      </div>
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 4, minHeight: 0 }}>
        {events.length === 0 && (
          <div className="mono" style={{ fontSize: 10, color: "var(--paper-4)" }}>
            Waiting for chain activity…
          </div>
        )}
        {events.map((e) => {
          const tone = e.kind === "spike"
            ? ((e.pct ?? 0) >= 0 ? "var(--buy)" : "var(--sell)")
            : e.kind === "deploy" ? "var(--amber)" : "var(--paper)";
          const glyph = e.kind === "deploy" ? "+ " : e.kind === "migration" ? "→ " : ((e.pct ?? 0) >= 0 ? "▲ " : "▼ ");
          const label = e.kind === "deploy" ? "DEPLOY"
            : e.kind === "migration" ? "MIGRATE"
            : `${(e.pct ?? 0) >= 0 ? "+" : ""}${(e.pct ?? 0).toFixed(0)}%`;
          return (
            <button key={e.id}
              onClick={() => openToken(e.mint)}
              className="mono"
              style={{
                background: "transparent", border: "none",
                display: "flex", alignItems: "center", gap: 8,
                padding: "4px 6px", borderRadius: 2, cursor: "pointer",
                textAlign: "left", color: "var(--paper-3)",
              }}
              onMouseEnter={(ev) => { ev.currentTarget.style.background = "var(--ink-2)"; }}
              onMouseLeave={(ev) => { ev.currentTarget.style.background = "transparent"; }}>
              <span style={{ color: tone, fontWeight: 700, fontSize: 11, minWidth: 14 }}>{glyph}</span>
              <span style={{ color: "var(--paper)", fontSize: 11, fontWeight: 600, minWidth: 60 }}>{e.symbol || shortAddr(e.mint, 3)}</span>
              <span style={{ color: tone, fontSize: 9, letterSpacing: "0.1em", minWidth: 56 }}>{label}</span>
              <span style={{ flex: 1, textAlign: "right", fontSize: 8, color: "var(--paper-4)", letterSpacing: "0.08em" }}>
                {fmtRelTime(e.ts)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// status bar
// ════════════════════════════════════════════════════════════════════════════
// status bar removed — the live pulse + sol price + mode toggle now sit at
// the top of the right rail (see RailHeader). The keyboard shortcut hints
// were moved into the help overlay.

// ════════════════════════════════════════════════════════════════════════════
// states + utils
// ════════════════════════════════════════════════════════════════════════════
function BootingState() {
  return (
    <div style={{
      position: "absolute", inset: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: 10,
    }}>
      <SpoolGlyph size={36} />
      <span className="ser" style={{ fontStyle: "italic", fontSize: 16, color: "var(--paper-3)" }}>
        Catching the stream…
      </span>
      <span className="mono eyebrow" style={{ fontSize: 8, color: "var(--paper-4)", letterSpacing: "0.18em" }}>
        AWAITING SNAPSHOT
      </span>
    </div>
  );
}
function EmptyState() {
  return (
    <div style={{
      position: "absolute", inset: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: 6,
    }}>
      <span className="ser" style={{ fontStyle: "italic", fontSize: 16, color: "var(--paper-3)" }}>
        Nothing matches the current filters
      </span>
      <span className="mono eyebrow" style={{ fontSize: 8, color: "var(--paper-4)", letterSpacing: "0.18em" }}>
        TRY DROPPING THE MCAP FLOOR
      </span>
    </div>
  );
}
function EmptyHint({ text }: { text: string }) {
  return (
    <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)" }}>{text}</span>
  );
}

function fmtFloor(v: number): string {
  const n = Math.pow(10, v);
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}
function fmtAge(min: number): string {
  if (!isFinite(min) || min < 0) return "–";
  if (min < 1) return `${Math.max(1, Math.round(min * 60))}s`;
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 1440) return `${(min / 60).toFixed(1)}h`;
  return `${(min / 1440).toFixed(1)}d`;
}
function fmtRelTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

