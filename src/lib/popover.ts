// Keep an absolutely/fixed-positioned popover, menu or dropdown fully on-screen.
// Several menus in this app position themselves from an anchor rect plus window
// math and can render off the right/left edge on a narrow phone. These clamps
// bound the chosen coordinate to the viewport with a small gutter.

const EDGE = 8;

function vw(override?: number): number {
  if (override != null) return override;
  return typeof window !== "undefined" ? window.innerWidth : 1024;
}
function vh(override?: number): number {
  if (override != null) return override;
  return typeof window !== "undefined" ? window.innerHeight : 768;
}

/** Clamp a left coordinate so a `menuWidth`-wide popover stays within the viewport. */
export function clampLeft(preferredLeft: number, menuWidth: number, viewportWidth?: number): number {
  const max = Math.max(EDGE, vw(viewportWidth) - menuWidth - EDGE);
  return Math.min(Math.max(preferredLeft, EDGE), max);
}

/** Clamp a top coordinate so a `menuHeight`-tall popover stays within the viewport. */
export function clampTop(preferredTop: number, menuHeight: number, viewportHeight?: number): number {
  const max = Math.max(EDGE, vh(viewportHeight) - menuHeight - EDGE);
  return Math.min(Math.max(preferredTop, EDGE), max);
}

/** A `max-width` that always fits within the viewport with `EDGE` gutters on both sides. */
export function viewportMaxWidth(gutter: number = EDGE): string {
  return `calc(100vw - ${gutter * 2}px)`;
}
