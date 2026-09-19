"use client";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "../../hooks/useMediaQuery";

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

type Props = {
  content: React.ReactNode;
  children: React.ReactElement;
  placement?: TooltipPlacement;
  delay?: number;
  maxWidth?: number;
  disabled?: boolean;
  mono?: boolean;
  /** When true, the tooltip becomes hoverable — user can move cursor into the
   *  tooltip without it closing, and buttons inside become clickable. */
  interactive?: boolean;
};

type Pos = { top: number; left: number; placement: TooltipPlacement; arrowOffset: number };

const GAP = 8;
const VIEWPORT_PAD = 6;

function computePosition(
  anchor: DOMRect,
  tip: { width: number; height: number },
  desired: TooltipPlacement,
): Pos {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;

  const fits = (p: TooltipPlacement) => {
    if (p === "top") return anchor.top - tip.height - GAP >= VIEWPORT_PAD;
    if (p === "bottom") return anchor.bottom + tip.height + GAP <= vh - VIEWPORT_PAD;
    if (p === "left") return anchor.left - tip.width - GAP >= VIEWPORT_PAD;
    return anchor.right + tip.width + GAP <= vw - VIEWPORT_PAD;
  };

  const order: TooltipPlacement[] = [desired, "top", "bottom", "right", "left"];
  const placement = order.find(fits) ?? desired;

  let top = 0;
  let left = 0;
  if (placement === "top") {
    top = anchor.top - tip.height - GAP;
    left = anchor.left + anchor.width / 2 - tip.width / 2;
  } else if (placement === "bottom") {
    top = anchor.bottom + GAP;
    left = anchor.left + anchor.width / 2 - tip.width / 2;
  } else if (placement === "left") {
    top = anchor.top + anchor.height / 2 - tip.height / 2;
    left = anchor.left - tip.width - GAP;
  } else {
    top = anchor.top + anchor.height / 2 - tip.height / 2;
    left = anchor.right + GAP;
  }

  const anchorCenterX = anchor.left + anchor.width / 2;
  const anchorCenterY = anchor.top + anchor.height / 2;

  left = Math.min(Math.max(VIEWPORT_PAD, left), vw - tip.width - VIEWPORT_PAD);
  top = Math.min(Math.max(VIEWPORT_PAD, top), vh - tip.height - VIEWPORT_PAD);

  // Keep arrow pointing at the anchor center after clamping. Offset is
  // measured from the tooltip's left/top edge (along the cross-axis),
  // clamped to stay within the tooltip's rounded corners.
  const CORNER_PAD = 10;
  const arrowOffset =
    placement === "top" || placement === "bottom"
      ? Math.min(Math.max(CORNER_PAD, anchorCenterX - left), tip.width - CORNER_PAD)
      : Math.min(Math.max(CORNER_PAD, anchorCenterY - top), tip.height - CORNER_PAD);

  return { top, left, placement, arrowOffset };
}

export function Tooltip({
  content,
  children,
  placement = "top",
  delay = 120,
  maxWidth = 260,
  disabled,
  mono,
  interactive,
}: Props) {
  const isMobile = useIsMobile();
  // On phones/tablets keep tooltips narrow so they never demand more horizontal
  // room than a 360px viewport offers (260 + 12px viewport pad needs ~272px).
  const effectiveMaxWidth = isMobile ? Math.min(maxWidth, 180) : maxWidth;
  // Prefer side placement on mobile: top/bottom tooltips clamp into a sliver
  // that wraps to many lines, whereas left/right uses the wider axis.
  const effectivePlacement: TooltipPlacement = isMobile
    ? placement === "top" || placement === "bottom"
      ? "right"
      : placement
    : placement;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<Pos>({ top: 0, left: 0, placement: effectivePlacement, arrowOffset: 0 });
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const show = useCallback(() => {
    if (disabled || !content) return;
    clearTimer();
    clearHideTimer();
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [clearTimer, clearHideTimer, delay, disabled, content]);

  const hide = useCallback(() => {
    clearTimer();
    if (interactive) {
      clearHideTimer();
      hideTimer.current = setTimeout(() => setOpen(false), 120);
    } else {
      setOpen(false);
    }
  }, [clearTimer, clearHideTimer, interactive]);

  useEffect(() => () => { clearTimer(); clearHideTimer(); }, [clearTimer, clearHideTimer]);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tipRef.current) return;
    const update = () => {
      if (!anchorRef.current || !tipRef.current) return;
      const a = anchorRef.current.getBoundingClientRect();
      const t = tipRef.current.getBoundingClientRect();
      setPos(computePosition(a, { width: t.width, height: t.height }, effectivePlacement));
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, effectivePlacement, content]);

  const child = children as React.ReactElement<Record<string, unknown>>;
  const childProps = child.props as Record<string, unknown>;

  const handlers = useMemo(
    () => ({
      onMouseEnter: (e: React.MouseEvent) => {
        show();
        const fn = childProps.onMouseEnter as ((e: React.MouseEvent) => void) | undefined;
        fn?.(e);
      },
      onMouseLeave: (e: React.MouseEvent) => {
        hide();
        const fn = childProps.onMouseLeave as ((e: React.MouseEvent) => void) | undefined;
        fn?.(e);
      },
      onFocus: (e: React.FocusEvent) => {
        show();
        const fn = childProps.onFocus as ((e: React.FocusEvent) => void) | undefined;
        fn?.(e);
      },
      onBlur: (e: React.FocusEvent) => {
        hide();
        const fn = childProps.onBlur as ((e: React.FocusEvent) => void) | undefined;
        fn?.(e);
      },
    }),
    [show, hide, childProps],
  );

  const setRefs = useCallback(
    (node: HTMLElement | null) => {
      anchorRef.current = node;
      const existing = (childProps as { ref?: React.Ref<HTMLElement> }).ref;
      if (typeof existing === "function") existing(node);
      else if (existing && typeof existing === "object")
        (existing as React.MutableRefObject<HTMLElement | null>).current = node;
    },
    [childProps],
  );

  const cloned = React.cloneElement(child, {
    ...handlers,
    ref: setRefs,
    // strip any native title so we don't get a duplicate browser tooltip
    title: undefined,
  } as Record<string, unknown>);

  if (disabled || !content) return cloned;

  const arrowSize = 5;
  const arrowStyle: React.CSSProperties = {
    position: "absolute",
    width: arrowSize * 2,
    height: arrowSize * 2,
    background: "var(--ink-2)",
    borderRight: "1px solid var(--line)",
    borderBottom: "1px solid var(--line)",
    pointerEvents: "none",
    ...(pos.placement === "top" && {
      bottom: -arrowSize,
      left: pos.arrowOffset - arrowSize,
      transform: "rotate(45deg)",
    }),
    ...(pos.placement === "bottom" && {
      top: -arrowSize,
      left: pos.arrowOffset - arrowSize,
      transform: "rotate(225deg)",
    }),
    ...(pos.placement === "left" && {
      right: -arrowSize,
      top: pos.arrowOffset - arrowSize,
      transform: "rotate(-45deg)",
    }),
    ...(pos.placement === "right" && {
      left: -arrowSize,
      top: pos.arrowOffset - arrowSize,
      transform: "rotate(135deg)",
    }),
  };

  return (
    <>
      {cloned}
      {mounted && open
        ? createPortal(
            <div
              ref={tipRef}
              role="tooltip"
              onMouseEnter={interactive ? clearHideTimer : undefined}
              onMouseLeave={interactive ? hide : undefined}
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                // On mobile keep the tooltip portal strictly below modals/sheets
                // so it never covers an open sheet; desktop keeps the high overlay.
                zIndex: isMobile ? "calc(var(--z-modal) - 1)" : 9999,
                maxWidth: isMobile
                  ? `min(${effectiveMaxWidth}px, calc(100vw - 16px))`
                  : maxWidth,
                padding: "5px 9px",
                fontSize: 11,
                lineHeight: 1.45,
                letterSpacing: mono ? 0 : "-0.005em",
                fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
                fontVariantNumeric: mono ? "tabular-nums" : undefined,
                fontWeight: 500,
                color: "var(--paper-2)",
                background: "var(--ink-2)",
                border: "1px solid var(--line)",
                borderRadius: "var(--r-2)",
                boxShadow: "var(--shadow-pop)",
                pointerEvents: interactive ? "auto" : "none",
                whiteSpace: "normal",
                wordBreak: mono ? "break-all" : "break-word",
                animation: `tooltipIn 140ms cubic-bezier(0.16, 1, 0.3, 1)`,
                transformOrigin:
                  pos.placement === "top" ? "50% 100%" :
                  pos.placement === "bottom" ? "50% 0%" :
                  pos.placement === "left" ? "100% 50%" : "0% 50%",
              }}
            >
              {content}
              <span aria-hidden style={arrowStyle} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
