"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSelectedToken } from "../../contexts/SelectedTokenContext";
import { useLiveTradePrices } from "../../hooks/useLiveTradePrices";
import { useNativeUsd } from "../../hooks/useNativeUsd";
import { useTokenEnrichment } from "../../hooks/useTokenEnrichment";
import { enrichWithMeta } from "../../hooks/enrichToken";
import { TokenRow } from "../TokenRow";
import { ColumnHeader, ColumnPauseToggle, ColumnQuickBuyInput, Icon, Tooltip } from "../atoms";
import { useFreezeOnHover } from "../../hooks/useFreezeOnHover";
import { Column, Empty } from "../DeployColumn";
import { useWatchlist } from "../../lib/watchlist";
import type { TokenEvent } from "../../types";

interface Props {
  onSelect?: (mint: string) => void;
  maxHeight?: string;
  titleSlot?: React.ReactNode;
}

export function WatchlistColumn({ onSelect, maxHeight = "100%", titleSlot }: Props) {
  const { entries, count, clear } = useWatchlist();
  const { selectedMint } = useSelectedToken();
  const solPrice = useNativeUsd();

  // Maintain a locally-enriched copy of the snapshots so images/stats
  // fill in via the same pipeline as the stream columns.
  const [tokens, setTokens] = useState<TokenEvent[]>(() => entries.map((e) => e.snapshot));
  const [enrichKey, setEnrichKey] = useState(0);
  const mintsKeyRef = useRef("");

  useEffect(() => {
    const key = entries.map((e) => e.mint).join(",");
    if (key === mintsKeyRef.current) return;
    mintsKeyRef.current = key;
    const snapshots = entries.map((e) => e.snapshot);
    setTokens(snapshots);
    setEnrichKey((k) => k + 1);
    snapshots.forEach((t) => enrichWithMeta(t, setTokens));
  }, [entries]);

  useTokenEnrichment(tokens, setTokens, 20, enrichKey);

  const visibleMints = useMemo(
    () => tokens.slice(0, 20).map((t) => t.mint_address),
    [tokens],
  );
  const initialPrices = useMemo(
    () => Object.fromEntries(
      tokens.slice(0, 20).flatMap((t) =>
        t.lastPrice != null && t.lastPrice > 0 ? [[t.mint_address, t.lastPrice]] : []
      )
    ),
    [tokens],
  );
  const liveMap = useLiveTradePrices(visibleMints, initialPrices);

  const [autoPause, setAutoPause] = useState(true);
  const { displayed, hovered, handlers } = useFreezeOnHover(tokens, autoPause);

  return (
    <Column>
      <ColumnHeader
        title={titleSlot ?? "Watchlist"}
        icon={<span style={{ color: "var(--gold, var(--paper))" }}>{Icon.starFilled(14)}</span>}
        actions={
          <>
            <ColumnQuickBuyInput column="watchlist" />
            <ColumnPauseToggle
              hovered={hovered}
              enabled={autoPause}
              onToggle={() => setAutoPause((p) => !p)}
            />
            {count > 0 && (
              <Tooltip content="Clear watchlist">
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      const ok = window.confirm(
                        `Remove all ${count} token${count === 1 ? "" : "s"} from watchlist?`,
                      );
                      if (!ok) return;
                    }
                    clear();
                  }}
                  aria-label="Clear watchlist"
                  style={{
                    width: 22,
                    height: 22,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 4,
                    color: "var(--paper-4)",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  {Icon.close(11)}
                </button>
              </Tooltip>
            )}
          </>
        }
      />
      <div style={{ flex: 1, overflow: "auto", maxHeight }} {...handlers}>
        {displayed.length === 0 && (
          <Empty>
            No tokens watched. Click the star on any token row to add it here.
          </Empty>
        )}
        {displayed.map((t) => (
          <TokenRow
            key={t.mint_address}
            t={t}
            variant="trending"
            quickBuyScope="watchlist"
            live={liveMap.get(t.mint_address)}
            solPrice={solPrice ?? undefined}
            onClick={onSelect}
            active={t.mint_address === selectedMint}
          />
        ))}
      </div>
    </Column>
  );
}
