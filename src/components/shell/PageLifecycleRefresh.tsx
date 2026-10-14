"use client";
import { useEffect } from "react";
import { softRefresh } from "../../lib/softRefresh";

/**
 * Start the live state over when the page comes back from a long absence,
 * without reloading it.
 *
 * Browsers throttle a background tab: its socket stalls and the server sheds
 * the stream events it could not deliver, so the lists can come back stale or
 * replay a backlog. A short absence is left alone: the socket reconnects on
 * its own and every subscription starts with a fresh snapshot. A long one, or
 * a tab the browser froze or restored from the bfcache, gets a soft refresh
 * (src/lib/softRefresh.ts): the connection is reset and the app mounts again
 * on the page it was on, with no blank page, no reload and the lock as it was.
 * A screen that must not lose its state (a launch in progress) holds it off.
 *
 * Triggers:
 *   • back to visible after being hidden for ≥ REFRESH_AFTER_HIDDEN_MS;
 *   • Page Lifecycle `resume`: the tab was frozen, its timers and socket dead;
 *   • `pageshow` from the bfcache (`persisted`): the socket closed on pagehide.
 */
const REFRESH_AFTER_HIDDEN_MS = 5 * 60_000;

export function PageLifecycleRefresh() {
  useEffect(() => {
    let hiddenSince: number | null =
      document.visibilityState === "hidden" ? Date.now() : null;
    let waitingForNetwork = false;

    const refresh = () => {
      // Offline, the new subscriptions would only fail: wait for the network.
      if (navigator.onLine === false) {
        if (waitingForNetwork) return;
        waitingForNetwork = true;
        window.addEventListener("online", () => {
          waitingForNetwork = false;
          softRefresh();
        }, { once: true });
        return;
      }
      softRefresh();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (hiddenSince === null) hiddenSince = Date.now();
        return;
      }
      const since = hiddenSince;
      hiddenSince = null;
      if (since !== null && Date.now() - since >= REFRESH_AFTER_HIDDEN_MS) refresh();
    };
    const onResume = () => refresh();
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) refresh();
    };

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("resume", onResume);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("resume", onResume);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return null;
}
