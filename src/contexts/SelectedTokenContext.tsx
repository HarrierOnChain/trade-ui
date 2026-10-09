"use client";
import React, { createContext, useContext, useState } from "react";

interface SelectedTokenCtx {
  selectedMint: string | null;
  setSelectedMint: (mint: string) => void;
}

const SelectedTokenContext = createContext<SelectedTokenCtx | null>(null);


export function SelectedTokenProvider({
  children,
  defaultMint,
}: {
  children: React.ReactNode;
  defaultMint?: string;
}) {
  const [selectedMint, setMint] = useState<string | null>(defaultMint ?? null);

  return (
    <SelectedTokenContext.Provider
      value={{
        selectedMint,
        setSelectedMint: setMint,
      }}
    >
      {children}
    </SelectedTokenContext.Provider>
  );
}

export function useSelectedToken(): SelectedTokenCtx {
  const ctx = useContext(SelectedTokenContext);
  if (!ctx) throw new Error("useSelectedToken must be used within SelectedTokenProvider");
  return ctx;
}
