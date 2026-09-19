"use client";
import React, { createContext, useContext } from "react";
import { DEFAULT_CARD_STYLE, type CardStyle } from "../lib/monitorTemplate";

const CardStyleContext = createContext<CardStyle>(DEFAULT_CARD_STYLE);

export function CardStyleProvider({
  value,
  children,
}: {
  value: CardStyle;
  children: React.ReactNode;
}) {
  return <CardStyleContext.Provider value={value}>{children}</CardStyleContext.Provider>;
}

export function useCardStyle(): CardStyle {
  return useContext(CardStyleContext);
}
