"use client";

import { useSyncExternalStore } from "react";

/**
 * SSR-safe media-query hook. Uses `useSyncExternalStore` so the server
 * snapshot (always `false`) and the first client render agree — React then
 * re-renders with the real match after hydration with no mismatch warning.
 *
 * The bulk of the responsive design lives in CSS `@media` rules (which apply
 * before JS even loads, so there is no flash). This hook is only for the
 * handful of *structural* changes that CSS can't express on its own — e.g.
 * rendering the wallet sidebar as an overlay drawer instead of an inline rail.
 */

// Keep these in sync with the breakpoints used in styles/globals.css.
export const MOBILE_BREAKPOINT = 768; // tablet-and-below: stacked / drawer chrome
export const PHONE_BREAKPOINT = 480; // small phone: most aggressive condensing

const serverSnapshot = () => false;

function subscribe(query: string) {
  return (onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mql = window.matchMedia(query);
    // Safari < 14 only has the deprecated add/removeListener API.
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else mql.removeListener(onChange);
    };
  };
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribe(query),
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    serverSnapshot,
  );
}

/** True at tablet width and below (≤768px) — the "use mobile chrome" switch. */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT}px)`);
}

/** True on small phones (≤480px) — the most aggressive layout condensing. */
export function useIsPhone(): boolean {
  return useMediaQuery(`(max-width: ${PHONE_BREAKPOINT}px)`);
}
