"use client";
// Client-side page manager that bypasses Next.js route transitions.
//
// All main pages are mounted once (lazily) and kept alive. Switching pages
// is a CSS `display:none` toggle — zero wait, zero re-mount, zero flash.
// Token detail (`/token/{chain}/{address}`) is also hosted here from the URL
// so opening a token does not wait on a Next.js RSC round-trip.
//
// Split into two parts:
//   <ClientNavProvider>  — wraps the whole shell so TopBar/SearchModal/etc.
//                          can call navigate() and read activePath
//   <ClientPages>        — renders inside <main>, manages page visibility

import React, {
  createContext, lazy, Suspense,
  useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { ClientPageVisibilityProvider } from "../../contexts/ClientPageVisibility";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { getActiveTokenMint } from "../../lib/activeToken";
import { hasPendingClone } from "../../lib/deployDraft";
import { parseTokenPath } from "../../lib/tokenHref";
import { TokenPageHost } from "./TokenPageHost";
import {
  requestDeployReset,
  SPOOL_SHELL_PATH,
} from "../../lib/shellNavigation";

// ── lazy pages ──────────────────────────────────────────────────────────────
const MonitorPage = lazy(() => import("../../app/monitor/page"));
const PortfolioPage = lazy(() => import("../../app/portfolio/page"));
const DeployPage = lazy(() => import("../../app/deploy/page"));
const SwapPage = lazy(() => import("../../app/swap/page"));

interface PageDef {
  id: string;
  path: string;
  /** Tab-title label — rendered as `"<title> | Raze Terminal"` while active. */
  title: string;
  /** Page sets its own live tab title (e.g. perps: pair + price); the central
   *  title effect leaves it alone so it isn't stomped back to the static label. */
  dynamicTitle?: boolean;
  Component: React.LazyExoticComponent<React.ComponentType>;
}

const PAGES: PageDef[] = [
  { id: "monitor",    path: "/monitor",    title: "Monitor",    Component: MonitorPage },
  { id: "portfolio",  path: "/portfolio",  title: "Portfolio",  Component: PortfolioPage },
  { id: "swap",       path: "/swap",       title: "Swap",       Component: SwapPage },
  { id: "deploy",     path: "/deploy",     title: "Deploy",     Component: DeployPage },
];

// Fired after navigate() rewrites the URL via pushState so query-param readers
// (useClientSearchParams) can re-sync — pushState alone emits no popstate.
const SPOOL_NAV_EVENT = "spool:navigate";

function resolvePageId(pathname: string): string | null {
  for (const p of PAGES) {
    if (pathname === p.path || pathname.startsWith(p.path + "/")) return p.id;
  }
  return null;
}

function resolvePagePath(pageId: string): string | null {
  for (const p of PAGES) {
    if (p.id === pageId) return p.path;
  }
  return null;
}

// ── context ─────────────────────────────────────────────────────────────────
interface ClientNavCtx {
  activePath: string;
  navigate: (path: string) => void;
  activePage: string | null;
  mounted: Set<string>;
}

const Ctx = createContext<ClientNavCtx>({
  activePath: "/",
  navigate: () => {},
  activePage: null,
  mounted: new Set(),
});

export function useClientNav() {
  const { activePath, navigate } = useContext(Ctx);
  return { activePath, navigate };
}

/**
 * Drop-in replacement for next/navigation's `useSearchParams` that also
 * reacts to client-side pushState navigations (which Next.js doesn't see).
 */
export function useClientSearchParams(): URLSearchParams {
  const { activePath } = useContext(Ctx);
  // Start with empty params so SSR and the first client render agree —
  // window.location.search is browser-only and would otherwise trip
  // React #418 (hydration mismatch) for consumers rendering its values.
  const [params, setParams] = useState<URLSearchParams>(() => new URLSearchParams());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setParams(new URLSearchParams(window.location.search));
    sync();
    // `navigate()` mutates the URL with pushState (which fires no popstate), so
    // a query-only change on the SAME page — e.g. /monitor → /monitor?edit=1 —
    // leaves activePath unchanged and would otherwise never re-read. Listen for
    // the shell's own nav signal to catch those.
    window.addEventListener(SPOOL_NAV_EVENT, sync);
    return () => window.removeEventListener(SPOOL_NAV_EVENT, sync);
  }, [activePath]);
  return params;
}

// ── provider — wrap the entire shell ────────────────────────────────────────
export function ClientNavProvider({ children }: { children: React.ReactNode }) {
  const nextPathname = usePathname();
  const router = useRouter();

  const [activePage, setActivePage] = useState<string | null>(() => resolvePageId(nextPathname));
  const [mounted, setMounted] = useState<Set<string>>(() => {
    const id = resolvePageId(nextPathname);
    return id ? new Set([id]) : new Set();
  });
  const [clientPath, setClientPath] = useState(nextPathname);

  // Persist last meaningful route for session restore.
  useEffect(() => {
    if (!clientPath || clientPath === "/" || clientPath.startsWith("/token/")) return;
    try { window.localStorage.setItem("spool.lastRoute", clientPath); } catch { /* ignore */ }
  }, [clientPath]);

  const activate = useCallback((id: string, path?: string) => {
    setActivePage(id);
    setClientPath(path ?? resolvePagePath(id) ?? "/");
    setMounted((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const navigate = useCallback((path: string) => {
    // Strip query string for page resolution, but keep the full path for
    // pushState so useSearchParams() still works.
    const pathname = path.split("?")[0].split("#")[0];
    const id = resolvePageId(pathname);
    if (id) {
      window.history.pushState(null, "", path);
      // Post-launch the URL is /token/<mint> while the wizard stays mounted.
      // Re-opening Deploy must remount a blank form — unless a clone seed is
      // waiting, which the already-mounted wizard applies via CLONE_SEED_EVENT.
      if (
        id === "deploy" &&
        clientPath.startsWith("/token/") &&
        getActiveTokenMint() &&
        !hasPendingClone()
      ) {
        requestDeployReset();
      }
      activate(id, pathname);
      window.dispatchEvent(new Event(SPOOL_NAV_EVENT));
    } else if (pathname.startsWith("/token/")) {
      window.history.pushState(null, "", path);
      setActivePage(null);
      setClientPath(pathname);
      window.dispatchEvent(new Event(SPOOL_NAV_EVENT));
    } else {
      router.push(path);
    }
  }, [router, activate, clientPath]);

  // Tab title follows the visible managed page ("Monitor | Trade UI").
  // Token detail (activePage === null) sets its own live title — ticker +
  // market cap — from TokenHeader, so we leave it untouched there.
  useEffect(() => {
    if (activePage === null) return;
    const page = PAGES.find((p) => p.id === activePage);
    if (page && !page.dynamicTitle) document.title = `${page.title} | Trade UI`;
  }, [activePage]);

  // In-place URL relabels (e.g. /deploy → /token/<mint> after launch).
  useEffect(() => {
    const onShellPath = (e: Event) => {
      const path = (e as CustomEvent<string>).detail;
      if (!path || typeof path !== "string") return;
      const id = resolvePageId(path);
      if (id) {
        activate(id, path);
      } else {
        setActivePage(null);
        setClientPath(path);
      }
    };
    window.addEventListener(SPOOL_SHELL_PATH, onShellPath);
    return () => window.removeEventListener(SPOOL_SHELL_PATH, onShellPath);
  }, [activate]);

  // Browser back/forward.
  useEffect(() => {
    const onPop = () => {
      const id = resolvePageId(window.location.pathname);
      if (id) {
        activate(id, window.location.pathname);
      } else {
        setActivePage(null);
        setClientPath(window.location.pathname);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [activate]);

  // Sync when Next.js navigates (initial load, /token/[mint]).
  const prevPathRef = useRef(nextPathname);
  useEffect(() => {
    if (nextPathname === prevPathRef.current) return;
    prevPathRef.current = nextPathname;
    const id = resolvePageId(nextPathname);
    if (id) {
      activate(id, nextPathname);
    } else {
      setActivePage(null);
      setClientPath(nextPathname);
    }
  }, [nextPathname, activate]);

  const ctx = useMemo<ClientNavCtx>(
    () => ({ activePath: clientPath, navigate, activePage, mounted }),
    [clientPath, navigate, activePage, mounted],
  );

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

// ── page renderer — lives inside <main> ─────────────────────────────────────
function PageFallback() {
  return (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: 0, background: "var(--ink-0)",
    }}>
      <svg width="20" height="20" viewBox="0 0 24 24"
        style={{ animation: "cp-spin 0.8s linear infinite" }}>
        <circle cx="12" cy="12" r="10" fill="none" stroke="var(--line)" strokeWidth="2" />
        <path d="M12 2 A10 10 0 0 1 22 12" fill="none"
          stroke="var(--paper-3)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <style>{`@keyframes cp-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

export function ClientPages({ nextChildren }: { nextChildren: React.ReactNode }) {
  const { activePage, mounted, activePath } = useContext(Ctx);
  const nextPathname = usePathname();
  // Next's children tree is the page that was SSR'd / last router.push'd —
  // NOT whatever pushState last wrote to the URL. Pin it so a client nav to
  // /deploy (or away from it) cannot keep showing the previous RSC page.
  const ssrPathRef = useRef(nextPathname);
  const ssrManagedId = resolvePageId(ssrPathRef.current);
  const isManaged = activePage !== null;
  const tokenPath = !isManaged ? parseTokenPath(activePath) : null;
  const isMobile = useIsMobile();
  const useSsrTree =
    nextPathname === ssrPathRef.current && activePage === ssrManagedId;

  // On mobile each page becomes the vertical scroll container (the desktop
  // frame keeps everything fixed and clips, which traps stacked content with
  // no way to reach it). Pages that keep their own internal 100%-height scroll
  // are unaffected — they just fill the bounded height instead of overflowing.
  const scroll: React.CSSProperties = isMobile
    ? { overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }
    : { overflow: "hidden" };

  // If Next already rendered this route, show that tree (it is in the page
  // JS). A second lazy() copy used to hide it behind a Suspense spinner, and
  // through Cursor's port proxy that chunk often never arrived after reload.
  const showNextChildren = !tokenPath && (!isManaged || useSsrTree);

  return (
    <>
      {PAGES.map((p) => {
        if (useSsrTree && p.id === ssrManagedId) return null;
        if (!mounted.has(p.id)) return null;
        const visible = isManaged && activePage === p.id;
        return (
          <div
            key={p.id}
            style={{
              display: visible ? "flex" : "none",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
              ...scroll,
            }}
          >
            <ClientPageVisibilityProvider active={visible}>
              <Suspense fallback={<PageFallback />}>
                <p.Component />
              </Suspense>
            </ClientPageVisibilityProvider>
          </div>
        );
      })}

      {tokenPath && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            ...scroll,
          }}
        >
          <TokenPageHost pathname={activePath} />
        </div>
      )}

      <div
        style={{
          display: showNextChildren ? "flex" : "none",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          ...scroll,
        }}
      >
        <ClientPageVisibilityProvider active={showNextChildren && (useSsrTree || !isManaged)}>
          {nextChildren}
        </ClientPageVisibilityProvider>
      </div>
    </>
  );
}
