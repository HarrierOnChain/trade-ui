"use client";
import { useEffect, useRef } from "react";

/**
 * IntersectionObserver-backed infinite scroll. Returns two refs:
 *   - sentinelRef: attach to the bottom sentinel element
 *   - rootRef: attach to the scrolling container (the IO root)
 *
 * When the sentinel enters the root's visible area, `onLoadMore` fires
 * while `enabled` is true. `rootMargin` pre-loads before the edge.
 */
export function useInfiniteScroll<S extends HTMLElement, R extends HTMLElement = HTMLElement>(
  onLoadMore: () => void,
  enabled: boolean,
  rootMargin = "300px"
) {
  const sentinelRef = useRef<S | null>(null);
  const rootRef = useRef<R | null>(null);
  const enabledRef = useRef(enabled);
  const cbRef = useRef(onLoadMore);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { cbRef.current = onLoadMore; }, [onLoadMore]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && enabledRef.current) cbRef.current();
        }
      },
      { root: rootRef.current ?? null, rootMargin }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [rootMargin, enabled]);

  return { sentinelRef, rootRef };
}
