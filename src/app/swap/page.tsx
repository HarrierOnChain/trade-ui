"use client";

/**
 * /swap — any pair of Solana tokens on the Raze router, from the connected
 * browser wallet or a local wallet. The token page's panel trades one token
 * against SOL/USDC; this is the free-form swap.
 */

import React from "react";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useChain } from "../../contexts/ChainContext";
import { SwapCard } from "../../components/SwapCard";

export default function SwapPage() {
  usePageTitle("Swap");
  const { chainId } = useChain();
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "28px 16px 40px" }}>
      {chainId === "sol" ? (
        <SwapCard />
      ) : (
        <div style={{ maxWidth: 460, margin: "40px auto", fontSize: 13, color: "var(--paper-3)", textAlign: "center", lineHeight: 1.6 }}>
          Swaps run on Solana for now: the EVM router does not quote yet. Switch the chain to SOL to swap.
        </div>
      )}
    </div>
  );
}
