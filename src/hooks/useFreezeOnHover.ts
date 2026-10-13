"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useFreezeOnHover<T extends { mint_address: string }>(
  list: T[],
  enabled: boolean,
) {
  const [hovered, setHovered] = useState(false);
  const [snapshot, setSnapshot] = useState<string[] | null>(null);
  const listRef = useRef(list);
  listRef.current = list;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const onMouseEnter = useCallback(() => {
    setHovered(true);
    if (enabledRef.current) {
      setSnapshot(listRef.current.map((t) => t.mint_address));
    }
  }, []);

  const onMouseLeave = useCallback(() => {
    setHovered(false);
    setSnapshot(null);
  }, []);

  useEffect(() => {
    if (!enabled) setSnapshot(null);
  }, [enabled]);

  const displayed = useMemo(() => {
    if (!snapshot) return list;
    const byMint = new Map(list.map((t) => [t.mint_address, t]));
    const out: T[] = [];
    for (const m of snapshot) {
      const t = byMint.get(m);
      if (t) out.push(t);
    }
    // Rows below the last frozen one join at the bottom: the ones scrolling
    // loads (more of the board). New rows above it (fresh launches, rank
    // climbers) wait for the pointer to leave, so nothing moves under it.
    const frozen = new Set(snapshot);
    let last = -1;
    list.forEach((t, i) => { if (frozen.has(t.mint_address)) last = i; });
    for (const t of list.slice(last + 1)) if (!frozen.has(t.mint_address)) out.push(t);
    return out;
  }, [snapshot, list]);

  return {
    displayed,
    hovered,
    handlers: { onMouseEnter, onMouseLeave },
  };
}
