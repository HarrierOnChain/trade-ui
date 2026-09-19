"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TokenEvent } from "../types";

let sharedCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedCtx) return sharedCtx;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedCtx = new Ctor();
  } catch {
    return null;
  }
  return sharedCtx;
}

export function playNewTokenBeep(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
}

const SEEN_CAP = 500;

export function useNewTokenSound(items: TokenEvent[], enabled: boolean): void {
  const seenRef = useRef<Set<string> | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (seenRef.current === null) {
      seenRef.current = new Set(items.map((t) => t.mint_address));
      return;
    }
    const seen = seenRef.current;
    let added = 0;
    for (const t of items) {
      const mint = t.mint_address;
      if (!mint) continue;
      if (!seen.has(mint)) {
        seen.add(mint);
        added++;
      }
    }
    if (seen.size > SEEN_CAP) {
      seenRef.current = new Set(items.map((t) => t.mint_address));
    }
    if (added > 0 && enabledRef.current) {
      playNewTokenBeep();
    }
  }, [items]);
}

export function useColumnSoundToggle(storageKey: string): {
  enabled: boolean;
  toggle: () => void;
} {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey) === "1") setEnabled(true);
    } catch {}
  }, [storageKey]);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {}
      if (next) {
        const ctx = getAudioCtx();
        if (ctx?.state === "suspended") ctx.resume().catch(() => {});
        playNewTokenBeep();
      }
      return next;
    });
  }, [storageKey]);

  return { enabled, toggle };
}
