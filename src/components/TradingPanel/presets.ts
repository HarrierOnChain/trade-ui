// Trading-panel preset model + defaults. Persisted via the backend
// `/preferences` store (see useUserPreference). Solana-ui's "DEGEN /
// DIAMOND / YOLO" tabs are kept as the seed values so a fresh login
// matches the source UI on first paint.

export interface PresetTab {
  id: string;
  label: string;
  buyPresets: string[];   // SOL, per-wallet (or total — see InputMode)
  sellPresets: string[];  // percentage strings ("25" = 25%)
}

export interface PresetState {
  tabs: PresetTab[];
  activeTabId: string;
}

export const defaultPresetTabs: PresetTab[] = [
  {
    id: "degen",
    label: "DEGEN",
    buyPresets: ["0.01", "0.05", "0.1", "0.5"],
    sellPresets: ["25", "50", "75", "100"],
  },
  {
    id: "diamond",
    label: "DIAMOND",
    buyPresets: ["0.001", "0.01", "0.05", "0.1"],
    sellPresets: ["10", "25", "50", "75"],
  },
  {
    id: "yolo",
    label: "YOLO",
    buyPresets: ["0.1", "0.5", "1", "5"],
    sellPresets: ["50", "75", "90", "100"],
  },
];

export const defaultPresetState: PresetState = {
  tabs: defaultPresetTabs,
  activeTabId: "degen",
};

// "0.01-0.05" — randomized buy size between min/max each fire.
export function resolvePresetValue(value: string): string {
  const parts = value.split("-");
  if (parts.length === 2) {
    const min = parseFloat(parts[0]);
    const max = parseFloat(parts[1]);
    if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
      const random = min + Math.random() * (max - min);
      const decimals = Math.max(
        (parts[0].split(".")[1] || "").length,
        (parts[1].split(".")[1] || "").length,
      );
      return random.toFixed(decimals);
    }
  }
  return value;
}

export function isValidPresetValue(val: string): boolean {
  const parts = val.split("-");
  if (parts.length === 1) {
    const n = parseFloat(val);
    return Number.isFinite(n) && n > 0;
  }
  if (parts.length === 2) {
    const min = parseFloat(parts[0]);
    const max = parseFloat(parts[1]);
    return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > min;
  }
  return false;
}

export type InputMode = "perWallet" | "cumulative";
export type Side = "buy" | "sell";
export type OrderType = "market" | "limit" | "adv" | "mm";

// ── Instant-trade panel (b33 InstantTradePanel design) ─────────────
// Five numbered presets P1..P5, each holding up to 8 buy + 8 sell
// amounts. Sell amounts are percentage strings ("25" → 25%); the panel
// also accepts the legacy "25%" form, recognized by .includes("%").
export interface InstantPreset {
  buyAmounts: string[];
  sellAmounts: string[];
}
export type InstantPresets = Record<string, InstantPreset>;

export const PRESET_KEYS = ["1", "2", "3", "4", "5"] as const;
export type PresetKey = typeof PRESET_KEYS[number];

export const defaultInstantPresets: InstantPresets = {
  "1": {
    buyAmounts: ["0.01", "0.05", "0.1", "0.5", "1", "2", "5", "10"],
    sellAmounts: ["10", "25", "50", "75", "100", "20", "40", "60"],
  },
  "2": {
    buyAmounts: ["0.001", "0.01", "0.05", "0.1", "0.25", "0.5", "1", "2"],
    sellAmounts: ["5", "10", "25", "50", "75", "100", "33", "66"],
  },
  "3": {
    buyAmounts: ["0.1", "0.5", "1", "5", "10", "25", "50", "100"],
    sellAmounts: ["25", "50", "75", "90", "100", "20", "40", "60"],
  },
  "4": {
    buyAmounts: ["0.05", "0.25", "0.5", "1", "2.5", "5", "10", "25"],
    sellAmounts: ["10", "20", "40", "60", "80", "100", "25", "75"],
  },
  "5": {
    buyAmounts: ["0.005", "0.05", "0.5", "5", "0.01", "0.1", "1", "10"],
    sellAmounts: ["20", "33", "50", "66", "80", "100", "10", "90"],
  },
};

// Backend preference keys — namespaced, version-suffixed so we can evolve
// the shape without breaking already-stored values.
export const PREF_KEYS = {
  presets: "trading.presets.v1",
  buyAmount: "trading.buyAmount.v1",
  buyInputMode: "trading.buyInputMode.v1",
  sellInputMode: "trading.sellInputMode.v1",
  slippageBps: "trading.slippageBps.v1",
  transactionsFee: "trading.transactionsFeeLamports.v1",
  // User-set fixed platform fee (lamports) → admin fee wallet. Formerly the
  // mislabeled "MEV tip" chip.
  fixedFee: "trading.fixedFeeLamports.v1",
  // MEV protection: relay trades as a sponsor-tipped Jito bundle.
  mevProtection: "trading.mevProtection.v1",
  floatingPos: "trading.floatingPos.v1",
  floatingOpen: "trading.floatingOpen.v1",
  instantPresets: "trading.instantPresets.v1",
  instantActivePreset: "trading.instantActivePreset.v1",
  instantSize: "trading.instantSize.v1",
  instantPos: "trading.instantPos.v1",
  instantOpacity: "trading.instantOpacity.v1",
  buyInputMint: "trading.buyInputMint.v1",
  sellOutputMint: "trading.sellOutputMint.v1",
  // Amount-input denomination for the manual field (market orders). Buy:
  // "quote" = spend the quote currency (exactIn, default) / "token" = receive an
  // exact token qty (exactOut). Sell: "token" = sell an exact token qty (exactIn,
  // default) / "quote" = receive an exact quote-currency amount (exactOut).
  buyDenom: "trading.buyDenom.v1",
  sellDenom: "trading.sellDenom.v1",
} as const;
