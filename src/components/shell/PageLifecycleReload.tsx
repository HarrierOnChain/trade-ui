"use client";
import { useEffect } from "react";

/**
 * Hard-refresh the page when it returns from a backgrounded / frozen state
 * instead of letting the live wire silently reconnect and replay a catch-up
 * flood of buffered stream events.
 *
 * Browsers (especially mobile, and Chrome's background-tab freezing) suspend
 * backgrounded tabs to reclaim memory: the WebSocket stops draining, the
 * backend sheds our stream events for the stale connection (see
 * backend lib/wire/server.ts), and on resume the socket would either
 * reconnect-and-replay every active subscription or dump whatever queued while
 * we were away. None of that is useful — the operator wants the *current*
 * state, not a stale replay — so we reload from scratch the moment the page
 * becomes interactive again.
 *
 * Triggers:
 *   • Page Lifecycle `resume` (the tab was frozen, then revived) — always reload.
 *   • `pageshow` restored from the bfcache (`persisted`) — the wire was torn
 *     down on `pagehide`, so reload.
 *   • `visibilitychange` back to visible after being hidden for
 *     ≥ RELOAD_AFTER_HIDDEN_MS — covers desktop tabs left in the background
 *     long enough to accumulate a backlog without a formal freeze.
 *
 * A hard reload re-requests the current URL, so the route, query, and scroll
 * anchor are preserved while all live state is rebuilt fresh.
 */
const RELOAD_AFTER_HIDDEN_MS = 30_000;

export function PageLifecycleReload() {
  useEffect(() => {
    let hiddenSince: number | null =
      document.visibilityState === "hidden" ? Date.now() : null;
    let reloading = false;

    const hardReload = () => {
      if (reloading) return;
      reloading = true;
      // Offline → a reload would just land on the browser error page. Wait for
      // the network to come back, then refresh.
      if (navigator.onLine === false) {
        window.addEventListener("online", () => window.location.reload(), {
          once: true,
        });
        return;
      }
      window.location.reload();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (hiddenSince === null) hiddenSince = Date.now();
        return;
      }
      const since = hiddenSince;
      hiddenSince = null;
      if (since !== null && Date.now() - since >= RELOAD_AFTER_HIDDEN_MS) {
        hardReload();
      }
    };

    // The tab was frozen to save resources, then revived — its sockets and
    // timers are dead, so always start clean.
    const onResume = () => hardReload();

    // bfcache restore: the page was fully unloaded and served back from cache
    // with its wire connections closed on pagehide.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) hardReload();
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
