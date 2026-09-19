"use client";

import { useCallback } from "react";
import { useClientNav } from "../components/shell/ClientPages";
import { setCloneSeed, type CloneSeed } from "../lib/deployDraft";

/** Loose token shape — accepts the various row/header/card token objects. */
export interface CloneTokenInput {
  name?: string | null;
  symbol?: string | null;
  description?: string | null;
  image?: string | null;
  imageUrl?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
}

/**
 * Returns `cloneToken(token)`: seeds the Create-Token wizard with the token's
 * metadata (name/symbol/description/image + socials), navigates to /deploy and
 * opens the wizard pre-filled — so the user reviews the metadata, picks a
 * launchpad and configures options for the relaunch.
 */
export function useCloneToken() {
  const { navigate } = useClientNav();
  return useCallback((t: CloneTokenInput) => {
    const seed: CloneSeed = {
      name: t.name ?? "",
      symbol: t.symbol ?? "",
      description: t.description ?? "",
      imageUrl: t.imageUrl ?? t.image ?? "",
      twitter: t.twitter ?? "",
      telegram: t.telegram ?? "",
      website: t.website ?? "",
    };
    setCloneSeed(seed);
    navigate("/deploy");
  }, [navigate]);
}
