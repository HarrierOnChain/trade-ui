"use client";
import { useEffect } from "react";

/**
 * Sets the browser tab title to `"<label> | Raze Terminal"` while the page is
 * mounted, so a backgrounded tab shows which surface is open (Axiom-style).
 *
 * Token surfaces manage their own live title (ticker + market cap) inside
 * `TokenHeader`, so they don't call this — pass a static label for the rest.
 */
export function usePageTitle(label: string): void {
  useEffect(() => {
    document.title = label ? `${label} | Raze Terminal` : "Raze Terminal";
  }, [label]);
}
