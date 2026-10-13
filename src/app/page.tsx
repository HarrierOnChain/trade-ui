"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

const VALID_ROUTES = ["/monitor", "/portfolio", "/swap", "/bundler"];

// Wallets moved into the portfolio on 2026-10-11; saved routes still name it.
const MOVED: Record<string, string> = { "/wallets": "/portfolio" };

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    let target = "/monitor";
    try {
      const raw = window.localStorage.getItem("spool.startup.route") ?? "last";
      const startup = MOVED[raw] ?? raw;
      if (startup !== "last" && VALID_ROUTES.includes(startup)) {
        target = startup;
      } else {
        const last = window.localStorage.getItem("spool.lastRoute");
        const saved = last ? MOVED[last] ?? last : last;
        if (saved && VALID_ROUTES.some((r) => saved === r || saved.startsWith(r + "/"))) {
          target = saved;
        }
      }
    } catch {
      /* ignore */
    }
    router.replace(target);
  }, [router]);

  return <div style={{ flex: 1, minHeight: 0 }} />;
}
