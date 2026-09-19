"use client";
import React, { forwardRef, useImperativeHandle, useState } from "react";

const RAZE_LOGO_SRC = "/logo/raze.svg";

export type BrandMarkHandle = { spin: () => void };

export const BrandMark = forwardRef<BrandMarkHandle, {
  size?: number;
  ariaLabel?: string;
  onClick?: () => void;
}>(function BrandMark({ size = 48, ariaLabel = "Toggle sidebar", onClick }, ref) {
  const [hover, setHover] = useState(false);
  const [pulsing, setPulsing] = useState(false);

  function spin() {
    setPulsing(true);
    window.setTimeout(() => setPulsing(false), 360);
  }

  useImperativeHandle(ref, () => ({ spin }), []);

  const innerSize = Math.round(size * 0.78);
  const glow = hover || pulsing
    ? "drop-shadow(0 0 10px color-mix(in oklch, var(--accent) 55%, transparent))"
    : "drop-shadow(0 0 0 transparent)";
  const scale = pulsing ? 0.92 : hover ? 1.04 : 1;

  return (
    <button
      type="button"
      onClick={() => onClick?.()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={ariaLabel}
      style={{
        width: size,
        height: size,
        padding: 0,
        margin: 0,
        background: hover
          ? "radial-gradient(circle at center, color-mix(in oklch, var(--accent) 14%, transparent) 0%, transparent 65%)"
          : "transparent",
        border: 0,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 0,
        borderRadius: 6,
        transition: "background 220ms ease",
      }}
    >
      <img
        src={RAZE_LOGO_SRC}
        alt="Raze Terminal"
        width={innerSize}
        height={innerSize}
        draggable={false}
        style={{
          display: "block",
          objectFit: "contain",
          transform: `scale(${scale})`,
          filter: glow,
          transition: "transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1), filter 280ms ease",
        }}
      />
    </button>
  );
});
