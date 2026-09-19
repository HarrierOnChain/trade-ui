// Helpers for building responsive *inline* styles. This app has no Tailwind and
// styles are mostly inline `style={{}}` objects, which cannot hold `@media`.
// Media-query-able concerns live in globals.css (and are exposed as CSS custom
// props read via var() inline). These helpers cover the cases that genuinely
// must be computed in JS: grid-template strings and clamp() widths.

/** A CSS `clamp()` width: never below `minPx`, scales with `prefVw`vw, never above `maxPx`. */
export function clampWidth(minPx: number, prefVw: number, maxPx: number): string {
  return `clamp(${minPx}px, ${prefVw}vw, ${maxPx}px)`;
}

/**
 * Auto-FILLING grid columns that never overflow their container: each track is
 * at least `min(100%, minPx)` so a single column takes the full row when the
 * container is narrower than `minPx` — this avoids the classic
 * `minmax(Npx, 1fr)` horizontal-overflow bug on phones — and at most `1fr`.
 * Use this instead of bare `minmax(Npx, 1fr)`.
 */
export function fluidCols(minPx: number): string {
  return `repeat(auto-fill, minmax(min(100%, ${minPx}px), 1fr))`;
}

/** Like {@link fluidCols} but auto-FIT (collapses empty tracks). */
export function fluidColsFit(minPx: number): string {
  return `repeat(auto-fit, minmax(min(100%, ${minPx}px), 1fr))`;
}
