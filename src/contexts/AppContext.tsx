"use client";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { readSession, type SystemConfig } from "../api/backend";
import { captureReferralFromUrl } from "../lib/referral";

export interface Toast {
  id: string;
  title: string;
  body?: React.ReactNode;
  tone?: "buy" | "sell" | "default";
  duration?: number;
  /** If provided, a mute button is shown on the toast that calls this. */
  onMute?: () => void;
}

export interface BuyIntent {
  token: { symbol: string; mint_address: string };
  side: "buy" | "sell";
  amount: number;
}

interface AppCtxValue {
  authed: boolean;
  setAuthed: (a: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  /** Pre-filled query consumed once by SearchModal on open (then cleared). */
  searchInitialQuery: string | null;
  /** Open search modal with an optional pre-filled query (e.g. a wallet address). */
  openSearch: (initialQuery?: string) => void;
  buyIntent: BuyIntent | null;
  setBuyIntent: (i: BuyIntent | null) => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  walletModalAddress: string | null;
  openWalletModal: (address: string) => void;
  closeWalletModal: () => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  sysConfig: SystemConfig | null;
  setSysConfig: (cfg: SystemConfig | null) => void;
  guestPhantomPubkey: string | null;
  setGuestPhantomPubkey: (k: string | null) => void;
  authModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  themeStudioOpen: boolean;
  openThemeStudio: () => void;
  closeThemeStudio: () => void;
  notificationsOpen: boolean;
  openNotifications: () => void;
  closeNotifications: () => void;
  deployModalOpen: boolean;
  openDeployModal: () => void;
  closeDeployModal: () => void;
}

const SIDEBAR_OPEN_KEY = "spool.sidebar.open";

const Ctx = createContext<AppCtxValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [authed, setAuthedState] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInitialQuery, setSearchInitialQuery] = useState<string | null>(null);
  const [buyIntent, setBuyIntent] = useState<BuyIntent | null>(null);
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
  const [sysConfig, setSysConfig] = useState<SystemConfig | null>(null);
  const [guestPhantomPubkey, setGuestPhantomPubkey] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const openAuthModal = useCallback(() => setAuthModalOpen(true), []);
  const closeAuthModal = useCallback(() => setAuthModalOpen(false), []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const [themeStudioOpen, setThemeStudioOpen] = useState(false);
  const openThemeStudio = useCallback(() => setThemeStudioOpen(true), []);
  const closeThemeStudio = useCallback(() => setThemeStudioOpen(false), []);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const openNotifications = useCallback(() => setNotificationsOpen(true), []);
  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const openDeployModal = useCallback(() => setDeployModalOpen(true), []);
  const closeDeployModal = useCallback(() => setDeployModalOpen(false), []);

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

  const setAuthed = useCallback((a: boolean) => {
    setAuthedState(a);
    try {
      localStorage.setItem("spool.authed", a ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    // Stash a ?ref=<code> referral link before anything else (it persists until
    // the next signup threads it into the login call).
    captureReferralFromUrl();
    try {
      if (localStorage.getItem("spool.authed") === "1" && readSession() !== null) {
        setAuthedState(true);
      } else {
        localStorage.removeItem("spool.authed");
      }
    } catch {
      /* ignore */
    }
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
      authed, setAuthed,
      searchOpen, setSearchOpen,
      searchInitialQuery,
      openSearch: (initialQuery?: string) => {
        setSearchInitialQuery(initialQuery ?? null);
        setSearchOpen(true);
      },
      buyIntent, setBuyIntent,
      toasts, pushToast,
      walletModalAddress, openWalletModal, closeWalletModal,
      sidebarOpen, toggleSidebar,
      sysConfig, setSysConfig,
      guestPhantomPubkey, setGuestPhantomPubkey,
      authModalOpen, openAuthModal, closeAuthModal,
      settingsOpen, openSettings, closeSettings,
      themeStudioOpen, openThemeStudio, closeThemeStudio,
      notificationsOpen, openNotifications, closeNotifications,
      deployModalOpen, openDeployModal, closeDeployModal,
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
