"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { TokenChartPopup } from "../TokenRow/TokenChartPopup";
import type { TokenEvent } from "../../types";
import type { LivePrice } from "../../hooks/useLiveTradePrices";

interface Props {
  token: TokenEvent;
  live?: LivePrice;
  solPrice?: number;
  children: React.ReactNode;
  /** Render as display:block instead of inline-flex — use when wrapping block-level displays like TokenIdentity */
  block?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export function TokenChartHover({
  token,
  live,
  solPrice,
  children,
  block = false,
  style,
  className,
}: Props) {
  const anchorRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }, [cancelClose]);

  const onMouseEnter = useCallback(() => {
    cancelClose();
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => setOpen(true), 200);
  }, [cancelClose]);

  const onMouseLeave = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    scheduleClose();
  }, [scheduleClose]);

  return (
    <>
      <span
        ref={(el) => { anchorRef.current = el; }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        style={{
          display: block ? "block" : "inline-flex",
          ...(block ? undefined : { alignItems: "center" }),
          ...style,
        }}
        className={className}
      >
        {children}
      </span>
      {open && token.mint_address && (
        <TokenChartPopup
          anchorRef={anchorRef}
          token={token}
          live={live}
          solPrice={solPrice}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        />
      )}
    </>
  );
}
