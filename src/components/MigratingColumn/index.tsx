"use client";
import React, { useMemo, useState } from "react";
import { useMigratingStream } from "../../hooks/useMigratingStream";
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

export function MigratingColumn({ onSelect, maxHeight = "100%", titleSlot }: Props) {
  const { get, platformString } = useFilters();
  const f = get("migrating");
  const platform = platformString("migrating");
  const { tokens, loading, error } = useMigratingStream(platform);
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
  const { enabled: soundOn, toggle: toggleSound } = useColumnSoundToggle("monitor:sound:migrating");
  useNewTokenSound(filtered, soundOn);

  return (
    <Column>
      <ColumnHeader
        title={titleSlot ?? "Migrating"}
        icon={<span style={{ color: "var(--accent)" }}>{Icon.migrate(14)}</span>}
        actions={
          <>
            <ColumnSearchInput column="migrating" />
            <ColumnQuickBuyInput column="migrating" />
            <ColumnSoundToggle enabled={soundOn} onToggle={toggleSound} />
            <ColumnPauseToggle hovered={hovered} enabled={autoPause} onToggle={() => setAutoPause((p) => !p)} />
            <ColumnConfig column="migrating" />
          </>
        }
      />
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", maxHeight }} {...handlers}>
        {error && <Empty>{error}</Empty>}
        {loading && tokens.length === 0 && <LoadingRows />}
        {!loading && displayed.length === 0 && !error && (
          <Empty>{tokens.length > 0 ? "No tokens match filters — adjust to see more" : "No migrating tokens yet…"}</Empty>
        )}
        {displayed.map((t, i) => (
          <TokenRow
            key={t.mint_address}
            t={t}
            variant="deploy"
            quickBuyScope="migrating"
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
