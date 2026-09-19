"use client";
import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";
import { useFilters, type ColumnKey } from "../../contexts/FiltersContext";
import { useIsPhone } from "../../hooks/useMediaQuery";

interface Props {
  column: ColumnKey;
}

export function ColumnSearchInput({ column }: Props) {
  const { get, update } = useFilters();
  const value = get(column).search;
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const isPhone = useIsPhone();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);

  const hasValue = text.trim().length > 0;
  const accent = "var(--buy)";
  const showExpanded = focused || hasValue;

  return (
    <Tooltip content="Filter tokens by name / symbol — comma-separated keywords">
      <span
        data-col-search
        onClick={() => inputRef.current?.focus()}
        style={{
          display: "inline-flex", alignItems: "center",
          gap: 4,
          padding: "0 6px",
          height: 26,
          background: "transparent",
          border: `1px solid ${showExpanded ? accent : "var(--line-soft)"}`,
          borderRadius: "var(--r-2)",
          transition: "border-color 120ms, width 160ms ease, box-shadow 120ms",
          // On phone share space with sibling tools (flex+min-width:0) instead
          // of locking to a fixed 160/90px that crushes neighbours.
          ...(isPhone
            ? { flex: 1, minWidth: 0, maxWidth: "100%", width: "auto" as const }
            : { width: showExpanded ? 160 : 90 }),
          cursor: "text",
          boxShadow: focused ? `0 0 0 3px ${accent}22` : "none",
        }}
      >
        <span style={{
          display: "inline-flex", lineHeight: 0,
          color: hasValue ? accent : "var(--paper-4)",
          transition: "color 120ms",
          flexShrink: 0,
        }}>{Icon.search(11)}</span>
        <input
          ref={inputRef}
          type="text"
          value={text}
          placeholder="Search"
          onChange={(e) => {
            setText(e.target.value);
            update(column, { search: e.target.value });
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setText("");
              update(column, { search: "" });
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          aria-label="Search tokens in this column"
          style={{
            flex: 1, minWidth: 0,
            background: "transparent",
            border: "none", outline: "none",
            color: "var(--paper)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            padding: 0,
          }}
        />
        {hasValue && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              setText("");
              update(column, { search: "" });
            }}
            aria-label="Clear search"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 14, height: 14,
              padding: 0,
              color: "var(--paper-4)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--paper)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--paper-4)")}
          >{Icon.close(10)}</button>
        )}
      </span>
    </Tooltip>
  );
}
