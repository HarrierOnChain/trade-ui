"use client";
import React, { useEffect } from "react";
import { AppProvider } from "../../contexts/AppContext";
import { AppZoomProvider, useAppZoom } from "../../contexts/AppZoomContext";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { SelectedTokenProvider } from "../../contexts/SelectedTokenContext";
import { LastSeenProvider } from "../../contexts/LastSeenContext";
import { FiltersProvider } from "../../contexts/FiltersContext";
import { ChainProvider } from "../../contexts/ChainContext";
import { TopBar } from "./TopBar";
import { TickerBar } from "./TickerBar";
import { StatusFooter } from "./StatusFooter";
import { SearchModal } from "./SearchModal";
import { LockGate } from "./LockGate";
import { WalletModal } from "./WalletModal";
import { ToastRail } from "./ToastRail";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { Sidebar } from "./Sidebar";
import { UserWalletsProvider } from "../../hooks/useUserWallets";
import { useApplyThemeMode } from "../../hooks/useThemeMode";
import { useApplyThemeFont } from "../../hooks/useThemeFont";
import { ThemeStudioModal } from "./ThemeStudioModal";
import { NotificationsModal } from "./NotificationsModal";
import { prefetchRoutes } from "../../lib/prefetchRoutes";
import { ClientNavProvider, ClientPages } from "./ClientPages";
import { PageLifecycleRefresh } from "./PageLifecycleRefresh";

export function Shell({ children }: { children: React.ReactNode }) {
  // Nothing below the gate mounts, fetches or opens a socket until this
  // browser has unlocked the vault.
  return (
    <LockGate>
      <ChainProvider>
      <AppProvider>
        <LastSeenProvider>
          <FiltersProvider>
            <SelectedTokenProvider>
              <AppZoomProvider>
                <UserWalletsProvider>
                  <PageLifecycleRefresh />
                  <PrefetchOnMount />
                  <ThemeAccentApplier />
                  <ThemeFontApplier />
                  <ClientNavProvider>
                    <AppZoomFrame>
                      <ShellChrome>{children}</ShellChrome>
                      <SearchModal />
                      <WalletModal />
                      <ThemeStudioModal />
                      <NotificationsModal />
                      <KeyboardShortcuts />
                    </AppZoomFrame>
                  </ClientNavProvider>
                  <ToastRail />
                </UserWalletsProvider>
              </AppZoomProvider>
            </SelectedTokenProvider>
          </FiltersProvider>
        </LastSeenProvider>
      </AppProvider>
      </ChainProvider>
    </LockGate>
  );
}

function PrefetchOnMount() {
  useEffect(() => { prefetchRoutes(); }, []);
  return null;
}

function ThemeAccentApplier() {
  useApplyThemeMode();
  return null;
}

function ThemeFontApplier() {
  useApplyThemeFont();
  return null;
}

function AppZoomFrame({ children }: { children: React.ReactNode }) {
  const { zoom } = useAppZoom();
  const isMobile = useIsMobile();
  // The desktop scale-zoom would shrink an already-tiny phone viewport (and
  // breaks pinch-to-zoom), so force 1× on mobile. We read the stored zoom but
  // never write it back here, so the user's desktop preference is preserved.
  const effectiveZoom = isMobile ? 1 : zoom;
  const zoomed = !isMobile && effectiveZoom !== 1;

  // Nudge autosize canvas widgets (token charts) to re-measure/redraw on
  // zoom change so they rasterise at the new scale.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = setTimeout(() => window.dispatchEvent(new Event("resize")), 80);
    return () => clearTimeout(id);
  }, [effectiveZoom]);

  return (
    <div
      className="app-vh"
      style={{
        width: "100%",
        overflow: "hidden",
        background: "var(--ink-0)",
      }}
    >
      <div style={{
        // CSS `zoom` (not `transform: scale`) so the chart canvas
        // is RE-rasterised at the zoomed scale instead of a blurry GPU stretch.
        // Sized in VIEWPORT units (not `%`, which failed to resolve the height
        // under zoom — see 2026-07-03 incident) so the frame fills exactly.
        width: zoomed ? `calc(100vw / ${effectiveZoom})` : "100%",
        height: zoomed ? `calc(100dvh / ${effectiveZoom})` : "100%",
        zoom: zoomed ? effectiveZoom : undefined,
      }}>
        {children}
      </div>
    </div>
  );
}

function ShellChrome({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100%",
      width: "100%",
      background: "var(--ink-0)",
      color: "var(--paper)",
      overflow: "hidden",
    }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <Sidebar />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          <TopBar />
          <TickerBar />
          <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <ClientPages nextChildren={children} />
          </main>
        </div>
      </div>
      <StatusFooter />
    </div>
  );
}
