"use client";

// Shell-level navigation signals for cases where the browser URL diverges from
// Next.js' internal pathname (e.g. /deploy going live in-place via replaceState).

export const SPOOL_SHELL_PATH = "spool:shell-path";
export const SPOOL_DEPLOY_RESET = "spool:deploy-reset";

/** Publish a pathname change the shell should reflect (no Next.js navigation). */
export function notifyShellPath(pathname: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SPOOL_SHELL_PATH, { detail: pathname }));
}

/** Remount the /deploy surface with a fresh preview mint and form state. */
export function requestDeployReset(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SPOOL_DEPLOY_RESET));
}
