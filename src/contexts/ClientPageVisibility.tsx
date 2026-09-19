"use client";
import React, { createContext, useContext } from "react";

/** True when the surrounding ClientPages panel is the active visible route. */
const Ctx = createContext(true);

export function ClientPageVisibilityProvider({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={active}>{children}</Ctx.Provider>;
}

export function useClientPageVisible(): boolean {
  return useContext(Ctx);
}
