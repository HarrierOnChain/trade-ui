// Chain registry for the self-hosted UI. Slugs match GET /chains
// (sol, eth, bsc, base, robinhood).

export const CHAIN_IDS = ["sol", "eth", "bsc", "base", "robinhood"] as const;
export type ChainId = (typeof CHAIN_IDS)[number];
export type ChainFamily = "solana" | "evm";

export interface Chain {
  id: ChainId;
  label: string;
  name: string;
  family: ChainFamily;
  networkId: number;
}

export const CHAINS: Record<ChainId, Chain> = {
  sol: { id: "sol", label: "SOL", name: "Solana", family: "solana", networkId: 1_399_811_149 },
  eth: { id: "eth", label: "ETH", name: "Ethereum", family: "evm", networkId: 1 },
  bsc: { id: "bsc", label: "BSC", name: "BNB Smart Chain", family: "evm", networkId: 56 },
  base: { id: "base", label: "BASE", name: "Base", family: "evm", networkId: 8453 },
  robinhood: { id: "robinhood", label: "HOOD", name: "Robinhood Chain", family: "evm", networkId: 4663 },
};

export const CHAIN_LIST: Chain[] = CHAIN_IDS.map((id) => CHAINS[id]);

const NATIVE: Record<ChainId, string> = {
  sol: "SOL",
  eth: "ETH",
  bsc: "BNB",
  base: "ETH",
  robinhood: "ETH",
};

export function nativeSymbol(id: ChainId): string {
  return NATIVE[id] ?? "SOL";
}

export function nativePriceKey(id: ChainId): "sol" | "eth" | "bnb" {
  if (id === "sol") return "sol";
  if (id === "bsc") return "bnb";
  return "eth";
}

export function chainFamily(id: ChainId): ChainFamily {
  return CHAINS[id]?.family ?? "solana";
}

export function isEvmChain(id: ChainId): boolean {
  return chainFamily(id) === "evm";
}

/** Whether the terminal trades on `id`: Solana on the Solana router, the EVM
 *  chains on the EVM router (src/api/localTrade.ts). Every chain does. */
export function swapsOn(id: ChainId = getActiveChain()): boolean {
  return isChainId(id);
}

export function coerceChainId(v: unknown): ChainId {
  if (typeof v === "string" && isChainId(v)) return v;
  if (typeof v === "number") {
    const hit = CHAIN_LIST.find((c) => c.networkId === v);
    if (hit) return hit.id;
  }
  return "sol";
}

/** DexScreener URL slug (`sol` → `solana`). */
export function dexscreenerSlug(id: ChainId): string {
  switch (id) {
    case "sol": return "solana";
    case "eth": return "ethereum";
    case "bsc": return "bsc";
    case "base": return "base";
    case "robinhood": return "robinhood";
  }
}

type ExplorerKind = "token" | "account" | "tx";

const EXPLORER_HOST: Record<ChainId, { host: string; accountPath: string }> = {
  sol: { host: "solscan.io", accountPath: "account" },
  eth: { host: "etherscan.io", accountPath: "address" },
  bsc: { host: "bscscan.com", accountPath: "address" },
  base: { host: "basescan.org", accountPath: "address" },
  robinhood: { host: "explorer.mainnet.chain.robinhood.com", accountPath: "address" },
};

export function explorerUrl(kind: ExplorerKind, value: string, id: ChainId = getActiveChain()): string {
  const spec = EXPLORER_HOST[id] ?? EXPLORER_HOST.sol;
  const path = kind === "account" ? spec.accountPath : kind;
  return `https://${spec.host}/${path}/${encodeURIComponent(value)}`;
}

export function explorerAccountUrl(address: string, id?: ChainId): string {
  return explorerUrl("account", address, id);
}

export function explorerTxUrl(signature: string, id?: ChainId): string {
  return explorerUrl("tx", signature, id);
}

export function explorerName(id: ChainId = getActiveChain()): string {
  switch (id) {
    case "sol": return "Solscan";
    case "eth": return "Etherscan";
    case "bsc": return "BscScan";
    case "base": return "Basescan";
    case "robinhood": return "Explorer";
  }
}

export const CHAIN_STORAGE_KEY = "raze.chain";
export const CHAIN_CHANGED_EVENT = "raze:chain-changed";

let activeChain: ChainId | null = null;

export function getActiveChain(): ChainId {
  if (activeChain === null) activeChain = readStoredChain() ?? "sol";
  return activeChain;
}

export function setActiveChain(id: ChainId): void {
  activeChain = id;
}

export function isChainId(value: string): value is ChainId {
  return (CHAIN_IDS as readonly string[]).includes(value);
}

export function readStoredChain(): ChainId | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CHAIN_STORAGE_KEY);
    if (raw && isChainId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeStoredChain(id: ChainId): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHAIN_STORAGE_KEY, id);
    releaseBodyPointerCapture();
    window.dispatchEvent(new CustomEvent(CHAIN_CHANGED_EVENT, { detail: { chainId: id } }));
  } catch {
    /* ignore */
  }
}

export function releaseBodyPointerCapture(): void {
  if (typeof document === "undefined") return;
  document.body.style.pointerEvents = "";
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}
