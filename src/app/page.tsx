"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

const VALID_ROUTES = ["/monitor", "/portfolio", "/wallets", "/swap"];

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    let target = "/monitor";
    try {
      const startup = window.localStorage.getItem("spool.startup.route") ?? "last";
      if (startup !== "last" && VALID_ROUTES.includes(startup)) {
        target = startup;
      } else {
        const saved = window.localStorage.getItem("spool.lastRoute");
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
