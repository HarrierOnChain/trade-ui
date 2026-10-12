"use client";
import React, { useMemo, useState } from "react";
import { useMigrationStream } from "../../hooks/useMigrationStream";
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
import { Column, Empty, LoadingRows } from "../DeployColumn";

interface Props {
  onSelect?: (mint: string) => void;
  maxHeight?: string;
  titleSlot?: React.ReactNode;
}

export function MigrationColumn({ onSelect, maxHeight = "100%", titleSlot }: Props) {
  const { get } = useFilters();
  const f = get("migration");
  const { tokens, loading, error } = useMigrationStream(f);
  const { selectedMint } = useSelectedToken();
  const solPrice = useNativeUsd();
  const visibleMints = useMemo(
    () => tokens.slice(0, 20).map((t) => t.mint_address),
    [tokens]
  );
  const liveMap = useLiveTradePrices(visibleMints);
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
  const { enabled: soundOn, toggle: toggleSound } = useColumnSoundToggle("monitor:sound:migration");
  useNewTokenSound(filtered, soundOn);

  return (
    <Column>
      <ColumnHeader
        title={titleSlot ?? "Migrated"}
        icon={<span style={{ color: "var(--accent)" }}>{Icon.migrate(14)}</span>}
        actions={
          <>
            <ColumnSearchInput column="migration" />
            <ColumnQuickBuyInput column="migration" />
            <ColumnSoundToggle enabled={soundOn} onToggle={toggleSound} />
            <ColumnPauseToggle hovered={hovered} enabled={autoPause} onToggle={() => setAutoPause((p) => !p)} />
            <ColumnConfig column="migration" />
          </>
        }
      />
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", maxHeight }} {...handlers}>
        {error && <Empty>{error}</Empty>}
        {loading && tokens.length === 0 && <LoadingRows />}
        {!loading && displayed.length === 0 && !error && (
          <Empty>{tokens.length > 0 || isFiltering(f) ? "No tokens match filters — adjust to see more" : "No migrations yet…"}</Empty>
        )}
        {displayed.map((t, i) => (
          <TokenRow
            key={t.mint_address}
            t={t}
            variant="migration"
            quickBuyScope="migration"
            rowIndex={i}
            live={liveMap.get(t.mint_address)}
            solPrice={solPrice ?? undefined}
            onClick={onSelect}
            active={t.mint_address === selectedMint}
            showMigrated
          />
        ))}
      </div>
    </Column>
  );
}
