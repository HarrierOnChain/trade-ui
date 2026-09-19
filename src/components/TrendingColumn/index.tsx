"use client";
import React, { useMemo, useState } from "react";
import { useAlertStream } from "../../hooks/useAlertStream";
import { useSelectedToken } from "../../contexts/SelectedTokenContext";
import { useLiveTradePrices } from "../../hooks/useLiveTradePrices";
import { useNativeUsd } from "../../hooks/useNativeUsd";
import { TokenRow } from "../TokenRow";
import { ColumnHeader, ColumnPauseToggle, ColumnSoundToggle, ColumnSearchInput, ColumnQuickBuyInput, Icon } from "../atoms";
import { ColumnConfig } from "../ColumnConfig";
import { useFilters } from "../../contexts/FiltersContext";
import { dedupeByName } from "../../lib/activity";
import { passesFilters } from "../../lib/tokenFilters";
import { useHiddenMints } from "../../lib/hiddenTokens";
import { useHiddenDevAddresses } from "../../lib/hiddenDevs";
import { useFreezeOnHover } from "../../hooks/useFreezeOnHover";
import { useColumnSoundToggle, useNewTokenSound } from "../../hooks/useNewTokenSound";
import { Column, Empty, LoadingRows } from "../DeployColumn";

interface Props {
  onSelect?: (mint: string) => void;
  maxHeight?: string;
  titleSlot?: React.ReactNode;
}

export function TrendingColumn({ onSelect, maxHeight = "100%", titleSlot }: Props) {
  const { get, platformString } = useFilters();
  const f = get("trending");
  const platform = platformString("trending");
  const { tokens, loading } = useAlertStream(platform);
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
        passesFilters(t, liveMap.get(t.mint_address), f),
    );
    return f.spam ? dedupeByName(kept, liveMap) : kept;
  }, [tokens, liveMap, f, hiddenMints, hiddenDevs]);
  const [autoPause, setAutoPause] = useState(true);
  const { displayed, hovered, handlers } = useFreezeOnHover(filtered, autoPause);
  const { enabled: soundOn, toggle: toggleSound } = useColumnSoundToggle("monitor:sound:trending");
  useNewTokenSound(filtered, soundOn);

  return (
    <Column>
      <ColumnHeader
        title={titleSlot ?? "Trending"}
        icon={<span style={{ color: "var(--accent)" }}>{Icon.trend(14)}</span>}
        actions={
          <>
            <ColumnSearchInput column="trending" />
            <ColumnQuickBuyInput column="trending" />
            <ColumnSoundToggle enabled={soundOn} onToggle={toggleSound} />
            <ColumnPauseToggle hovered={hovered} enabled={autoPause} onToggle={() => setAutoPause((p) => !p)} />
            <ColumnConfig column="trending" />
          </>
        }
      />
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", maxHeight }} {...handlers}>
        {loading && tokens.length === 0 && <LoadingRows />}
        {!loading && displayed.length === 0 && (
          <Empty>{tokens.length > 0 ? "No tokens match filters — adjust to see more" : "Waiting for alerts…"}</Empty>
        )}
        {displayed.map((t, i) => (
          <TokenRow
            key={t.mint_address || i}
            t={t}
            variant="trending"
            quickBuyScope="trending"
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
