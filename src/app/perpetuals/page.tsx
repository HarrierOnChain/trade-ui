"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { legacyPerpetualsRedirect } from "../../lib/perpRoutes";

/** Redirect legacy `/perpetuals?market=…` bookmarks to `/perps/jup-SOL`. */
export default function LegacyPerpetualsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    router.replace(legacyPerpetualsRedirect(searchParams.get("market")));
  }, [router, searchParams]);

  return null;
}
