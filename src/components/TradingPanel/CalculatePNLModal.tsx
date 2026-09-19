"use client";
import React from "react";
import { Modal, Icon, ModalHeader } from "../atoms";
import { PnlCard } from "./PnlCard";
import { useTokenInfo } from "../../hooks/useTokenInfo";
import { useUserWallets } from "../../hooks/useUserWallets";

interface Props {
  open: boolean;
  onClose: () => void;
  mint: string;
}

// Aggregate PnL receipt for the active wallets on a given token. The
// numbers are derived from the same balance map the trading panel
// already uses, so the share card matches what the user sees in the
// header pill. tradingStats.bought/sold/trades isn't tracked yet — the
// card shows zeros for those until that history lands.
export function CalculatePNLModal({ open, onClose, mint }: Props) {
  const { info } = useTokenInfo(mint);
  const userWallets = useUserWallets();

  const wallets = userWallets.activeWallets.length
    ? userWallets.activeWallets
    : userWallets.wallets;

  const totalTokens = wallets.reduce(
    (sum, w) => sum + (userWallets.balances[w.id]?.tokens[mint] ?? 0),
    0,
  );
  const price = info?.lastPrice ?? 0;
  const holdingsValue = totalTokens * price;

  return (
    <Modal open={open} onClose={onClose} width={520}>
      <ModalHeader title="Share P&L" icon={Icon.chart(16)} onClose={onClose} />

      <div style={{ padding: "16px 20px", overflowY: "auto", background: "var(--ink-1)" }}>
        <PnlCard
          totalPnl={holdingsValue}
          bought={0}
          sold={0}
          holdingsValue={holdingsValue}
          totalWallets={wallets.length}
          trades={0}
          tokenSymbol={info?.symbol ?? undefined}
          tokenAddress={mint}
        />
      </div>
    </Modal>
  );
}
