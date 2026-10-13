"use client";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export interface Toast {
  id: string;
  title: string;
  body?: React.ReactNode;
  /** `buy` / `sell`: trade fills (the user can turn those off); `success` /
   *  `error`: the outcome of anything else. */
  tone?: "buy" | "sell" | "success" | "error" | "default";
  duration?: number;
}

interface AppCtxValue {
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  walletModalAddress: string | null;
  openWalletModal: (address: string) => void;
  closeWalletModal: () => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  themeStudioOpen: boolean;
  openThemeStudio: () => void;
  closeThemeStudio: () => void;
  notificationsOpen: boolean;
  openNotifications: () => void;
  closeNotifications: () => void;
}

const SIDEBAR_OPEN_KEY = "spool.sidebar.open";

const Ctx = createContext<AppCtxValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [walletModalAddress, setWalletModalAddress] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    // SSR: window not available — return true so server output matches desktop default.
    if (typeof window === "undefined") return true;
    // Mobile: the sidebar is a full-screen overlay drawer — always start closed
    // so it never blocks the TopBar, regardless of any stored desktop preference.
    if (window.matchMedia?.("(max-width: 768px)").matches) return false;
    try {
      const raw = localStorage.getItem(SIDEBAR_OPEN_KEY);
      return raw != null ? raw === "1" : true;
    } catch {
      return true;
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const [themeStudioOpen, setThemeStudioOpen] = useState(false);
  const openThemeStudio = useCallback(() => setThemeStudioOpen(true), []);
  const closeThemeStudio = useCallback(() => setThemeStudioOpen(false), []);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const openNotifications = useCallback(() => setNotificationsOpen(true), []);
  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_OPEN_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const openWalletModal = useCallback((address: string) => {
    setWalletModalAddress(address);
  }, []);
  const closeWalletModal = useCallback(() => {
    setWalletModalAddress(null);
  }, []);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, ...t }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, t.duration ?? 4200);
  }, []);

  useEffect(() => {
    try {
      const isMob = window.matchMedia?.("(max-width: 768px)").matches;
      if (isMob) {
        // Mobile: drawer always starts closed — never inherit a desktop pref.
        setSidebarOpen(false);
      } else {
        const raw = localStorage.getItem(SIDEBAR_OPEN_KEY);
        if (raw != null) setSidebarOpen(raw === "1");
      }
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <Ctx.Provider value={{
      searchOpen, setSearchOpen,
      toasts, pushToast,
      walletModalAddress, openWalletModal, closeWalletModal,
      sidebarOpen, toggleSidebar,
      settingsOpen, openSettings, closeSettings,
      themeStudioOpen, openThemeStudio, closeThemeStudio,
      notificationsOpen, openNotifications, closeNotifications,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}
