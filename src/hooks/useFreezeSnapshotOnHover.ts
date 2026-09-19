"use client";
import { useCallback, useRef, useState } from "react";

/** Freeze a list snapshot while the pointer is over the container. */
export function useFreezeSnapshotOnHover<T>(list: T[]) {
  const [hovered, setHovered] = useState(false);
  const [snapshot, setSnapshot] = useState<T[] | null>(null);
  const listRef = useRef(list);
  listRef.current = list;

  const onMouseEnter = useCallback(() => {
    setHovered(true);
    setSnapshot([...listRef.current]);
  }, []);

  const onMouseLeave = useCallback(() => {
    setHovered(false);
    setSnapshot(null);
  }, []);

  return {
    displayed: snapshot ?? list,
    hovered,
    handlers: { onMouseEnter, onMouseLeave },
  };
}
