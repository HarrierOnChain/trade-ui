"use client";
import React, { useMemo, useState } from "react";
import { useDeployStream } from "../../hooks/useDeployStream";
import { useSelectedToken } from "../../contexts/SelectedTokenContext";
import { useLiveTradePrices } from "../../hooks/useLiveTradePrices";
import { useNativeUsd } from "../../hooks/useNativeUsd";
import { TokenRow } from "../TokenRow";
import { ColumnHeader, ColumnPauseToggle, ColumnSoundToggle, ColumnSearchInput, ColumnQuickBuyInput, Icon } from "../atoms";
import { ColumnConfig } from "../ColumnConfig";
import { useFilters } from "../../contexts/FiltersContext";
import { dedupeByName } from "../../lib/activity";
import { isFiltering, passesFilters } from "../../lib/tokenFilters";
import { useHiddenMints } from "../../lib/hiddenTokens";
import { useHiddenDevAddresses } from "../../lib/hiddenDevs";
import { useFreezeOnHover } from "../../hooks/useFreezeOnHover";
import { useColumnSoundToggle, useNewTokenSound } from "../../hooks/useNewTokenSound";
import { useIsMobile } from "../../hooks/useMediaQuery";

interface Props {
  onSelect?: (mint: string) => void;
  maxHeight?: string;
  titleSlot?: React.ReactNode;
}

export function DeployColumn({ onSelect, maxHeight = "100%", titleSlot }: Props) {
  const { get } = useFilters();
  const f = get("deploy");
  const { tokens, loading, error } = useDeployStream(f);
  const { selectedMint } = useSelectedToken();
  const solPrice = useNativeUsd();
  const visibleMints = useMemo(
    () => tokens.slice(0, 20).map((t) => t.mint_address),
    [tokens]
  );
  const initialPrices = useMemo(
    () => Object.fromEntries(
      tokens.slice(0, 20).flatMap((t) =>
        t.lastPrice != null && t.lastPrice > 0 ? [[t.mint_address, t.lastPrice]] : []
      )
    ),
    [tokens]
  );
  const liveMap = useLiveTradePrices(visibleMints, initialPrices);
  const hiddenMints = useHiddenMints();
  const hiddenDevs = useHiddenDevAddresses();

  const filtered = useMemo(() => {
    const kept = tokens.filter(
      (t) =>
        !hiddenMints.has(t.mint_address) &&
        !(t.signer && hiddenDevs.has(t.signer)) &&
        passesFilters(t, f),
    );
    return f.spam ? dedupeByName(kept) : kept;
  }, [tokens, liveMap, f, hiddenMints, hiddenDevs]);
  const [autoPause, setAutoPause] = useState(true);
  const { displayed, hovered, handlers } = useFreezeOnHover(filtered, autoPause);
  const { enabled: soundOn, toggle: toggleSound } = useColumnSoundToggle("monitor:sound:deploy");
  useNewTokenSound(filtered, soundOn);

  return (
    <Column>
      <ColumnHeader
        title={titleSlot ?? "New Deploys"}
        icon={<span style={{ color: "var(--accent)" }}>{Icon.deploy(14)}</span>}
        actions={
          <>
            <ColumnSearchInput column="deploy" />
            <ColumnQuickBuyInput column="deploy" />
            <ColumnSoundToggle enabled={soundOn} onToggle={toggleSound} />
            <ColumnPauseToggle hovered={hovered} enabled={autoPause} onToggle={() => setAutoPause((p) => !p)} />
            <ColumnConfig column="deploy" />
          </>
        }
      />
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", maxHeight }} {...handlers}>
        {error && <Empty>{error}</Empty>}
        {loading && tokens.length === 0 && <LoadingRows />}
        {!loading && displayed.length === 0 && !error && (
          <Empty>{tokens.length > 0 || isFiltering(f) ? "No tokens match filters — adjust to see more" : "No tokens yet…"}</Empty>
        )}
        {displayed.map((t, i) => (
          <TokenRow
            key={t.mint_address}
            t={t}
            variant="deploy"
            quickBuyScope="deploy"
            rowIndex={i}
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

export function Column({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      // Desktop columns hold a 280px floor so the board reads as columns; on
      // mobile (stacked, full-width) let them shrink fully to the viewport.
      flex: 1, minWidth: isMobile ? 0 : 280, minHeight: 0,
      background: "var(--ink-1)",
      overflow: "hidden",
    }}>{children}</div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: 24, textAlign: "center",
      color: "var(--paper-4)", fontSize: 12,
    }}>{children}</div>
  );
}

export function LoadingRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--line-soft)",
          display: "flex", gap: 10,
        }}>
          <div className="skeleton" style={{ width: 34, height: 34, borderRadius: 4 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="skeleton" style={{ width: "60%", height: 10 }} />
            <div className="skeleton" style={{ width: "40%", height: 8 }} />
          </div>
          <div className="skeleton" style={{ width: 60, height: 10 }} />
        </div>
      ))}
    </>
  );
}
