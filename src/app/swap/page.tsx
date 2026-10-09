"use client";

/**
 * /swap — any pair of tokens from a vault wallet: on Solana on the Raze
 * router, on Ethereum, BNB Chain, Base and Robinhood on the Raze EVM router.
 * The token page's panel trades one token against the chain's quote assets;
 * this is the free-form swap.
 */

import React from "react";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useChain } from "../../contexts/ChainContext";
import { SwapCard } from "../../components/SwapCard";
import { EvmSwapCard } from "../../components/SwapCard/EvmSwapCard";

export default function SwapPage() {
  usePageTitle("Swap");
  const { chainId } = useChain();
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "28px 16px 40px" }}>
      {chainId === "sol" ? <SwapCard /> : <EvmSwapCard key={chainId} chain={chainId} />}
    </div>
  );
}
