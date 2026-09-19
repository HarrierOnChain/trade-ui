"use client";
import React from "react";
import { Modal, Btn, Icon, SolAmount, ModalHeader, ModalKvRow } from "../atoms";
import { useApp } from "../../contexts/AppContext";
import { fmtSol } from "../../lib/format";

export function ConfirmModal() {
  const { buyIntent, setBuyIntent, pushToast } = useApp();
  const open = !!buyIntent;

  function confirm() {
    if (!buyIntent) return;
    pushToast({
      title: `${buyIntent.side.toUpperCase()} FILLED`,
      body: <><SolAmount>{fmtSol(buyIntent.amount)}</SolAmount> → {buyIntent.token.symbol} · tx 2tNz…9Gj1</>,
      tone: buyIntent.side,
    });
    setBuyIntent(null);
  }

  return (
    <Modal open={open} onClose={() => setBuyIntent(null)} width={380}>
      {buyIntent && (
        <>
          <ModalHeader title={`Confirm ${buyIntent.side}`} onClose={() => setBuyIntent(null)} />

          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12, background: "var(--ink-1)" }}>
            <ModalKvRow label="Side" value={<span style={{
              color: buyIntent.side === "buy" ? "var(--buy)" : "var(--sell)",
              fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em",
              fontSize: 12,
            }}>{buyIntent.side}</span>} />
            <ModalKvRow label="Token" value={
              <span className="mono" style={{ fontWeight: 600 }}>{buyIntent.token.symbol}</span>
            } />
            <ModalKvRow label="Amount" value={<span className="mono"><SolAmount>{fmtSol(buyIntent.amount)}</SolAmount></span>} />
            <ModalKvRow label="Slippage" value={<span className="mono">3.0%</span>} />
            <ModalKvRow label="Priority" value={<span className="mono">Turbo · <SolAmount>0.005</SolAmount></span>} />

            <div style={{ height: 1, background: "var(--line-soft)", margin: "4px 0" }} />

            <div style={{ display: "flex", gap: 8 }}>
              <Btn
                tone="ghost"
                size="md"
                onClick={() => setBuyIntent(null)}
                style={{ flex: 1 }}
              >
                Cancel
              </Btn>
              <Btn
                tone={buyIntent.side === "buy" ? "buy" : "sell"}
                size="md"
                onClick={confirm}
                style={{ flex: 1 }}
                icon={Icon.bolt(12)}
              >
                Confirm {buyIntent.side}
              </Btn>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
