"use client";
import { useEffect, useRef } from "react";
import { useApp } from "../../contexts/AppContext";
import { useClientNav } from "./ClientPages";

export function KeyboardShortcuts() {
  const { navigate } = useClientNav();
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const { setSearchOpen } = useApp();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target && ["INPUT", "TEXTAREA"].includes(target.tagName);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === "/" && !inField) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key.toLowerCase() === "g" && !inField) {
        const next = (ev: KeyboardEvent) => {
          const k = ev.key.toLowerCase();
          if (k === "m") navRef.current("/monitor");
          if (k === "p") navRef.current("/portfolio");
          if (k === "d") navRef.current("/deploy");
          window.removeEventListener("keydown", next);
        };
        window.addEventListener("keydown", next);
        setTimeout(() => window.removeEventListener("keydown", next), 1500);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  return null;
}
