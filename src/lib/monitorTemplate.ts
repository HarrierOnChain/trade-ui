/** The Trenches columns: a launch's life, always these three in this order.
 *  (Trending and Watchlist columns are gone: the ranking is the Discover
 *  page, starred tokens are in the ticker bar.) */
export type ColumnType = "deploy" | "migrating" | "migration";

export const COLUMN_TYPES: ColumnType[] = ["deploy", "migrating", "migration"];

export const COLUMN_LABEL: Record<ColumnType, string> = {
  deploy: "New Deploys",
  migrating: "Migrating",
  migration: "Migrated",
};

export interface SlotStyle {
  flex: number;
  paddingX: number;
  paddingY: number;
  borderWidth: number;
  borderColor: string;
  borderRadius: number;
  background: string;
}

export interface CardStyle {
  scale: number;          // CSS zoom multiplier — scales every px in the column
  showSparkline: boolean;
}

export interface Slot {
  id: string;
  type: ColumnType;
  style: SlotStyle;
  card: CardStyle;
}

export interface ContainerStyle {
  paddingX: number;
  paddingY: number;
  gap: number;
  background: string;
}

export interface MonitorTemplate {
  version: 1;
  name: string;
  container: ContainerStyle;
  slots: Slot[];
}

export const STORAGE_KEY = "monitor:template:v2";

export const DEFAULT_SLOT_STYLE: SlotStyle = {
  flex: 1,
  paddingX: 0,
  paddingY: 0,
  borderWidth: 0,
  borderColor: "var(--line-soft)",
  borderRadius: 0,
  background: "transparent",
};

export const DEFAULT_CARD_STYLE: CardStyle = {
  scale: 1,
  showSparkline: false,
};

export const DEFAULT_CONTAINER_STYLE: ContainerStyle = {
  paddingX: 0,
  paddingY: 0,
  gap: 1,
  background: "transparent",
};

export function defaultTemplate(): MonitorTemplate {
  return {
    version: 1,
    name: "Default",
    container: { ...DEFAULT_CONTAINER_STYLE },
    slots: launchColumns([]),
  };
}

/**
 * The three columns in their order, each with the style a saved column of
 * its type had (the first one, if a layout had several), else the default.
 * Saved Trending or Watchlist columns are dropped.
 */
export function launchColumns(saved: Slot[]): Slot[] {
  return COLUMN_TYPES.map((type) => {
    const had = saved.find((s) => s.type === type);
    return had
      ? { ...had, type }
      : { id: makeId(), type, style: { ...DEFAULT_SLOT_STYLE }, card: { ...DEFAULT_CARD_STYLE } };
  });
}

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function isColumnType(v: unknown): v is ColumnType {
  return typeof v === "string" && (COLUMN_TYPES as string[]).includes(v);
}

function sanitizeCardStyle(raw: unknown): CardStyle {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (k: string, fallback: number, min: number, max: number) => {
    const v = typeof o[k] === "number" ? (o[k] as number) : fallback;
    return Math.max(min, Math.min(max, v));
  };
  const bool = (k: string, fallback: boolean) =>
    typeof o[k] === "boolean" ? (o[k] as boolean) : fallback;
  return {
    scale: num("scale", 1, 0.6, 1.8),
    showSparkline: bool("showSparkline", false),
  };
}

function sanitizeSlotStyle(raw: unknown): SlotStyle {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (k: string, fallback: number, min: number, max: number) => {
    const v = typeof o[k] === "number" ? (o[k] as number) : fallback;
    return Math.max(min, Math.min(max, v));
  };
  const str = (k: string, fallback: string) =>
    typeof o[k] === "string" && (o[k] as string).length < 200 ? (o[k] as string) : fallback;
  return {
    flex: num("flex", 1, 0.25, 6),
    paddingX: num("paddingX", 0, 0, 48),
    paddingY: num("paddingY", 0, 0, 48),
    borderWidth: num("borderWidth", 0, 0, 6),
    borderColor: str("borderColor", DEFAULT_SLOT_STYLE.borderColor),
    borderRadius: num("borderRadius", 0, 0, 24),
    background: str("background", DEFAULT_SLOT_STYLE.background),
  };
}

function sanitizeContainerStyle(raw: unknown): ContainerStyle {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (k: string, fallback: number, min: number, max: number) => {
    const v = typeof o[k] === "number" ? (o[k] as number) : fallback;
    return Math.max(min, Math.min(max, v));
  };
  const str = (k: string, fallback: string) =>
    typeof o[k] === "string" && (o[k] as string).length < 200 ? (o[k] as string) : fallback;
  return {
    paddingX: num("paddingX", 0, 0, 64),
    paddingY: num("paddingY", 0, 0, 64),
    gap: num("gap", 1, 0, 32),
    background: str("background", DEFAULT_CONTAINER_STYLE.background),
  };
}

export function sanitizeTemplate(raw: unknown): MonitorTemplate {
  if (!raw || typeof raw !== "object") return defaultTemplate();
  const o = raw as Record<string, unknown>;
  const slotsRaw = Array.isArray(o.slots) ? o.slots : [];
  const slots: Slot[] = [];
  for (const s of slotsRaw) {
    if (!s || typeof s !== "object") continue;
    const so = s as Record<string, unknown>;
    if (!isColumnType(so.type)) continue;
    slots.push({
      id: typeof so.id === "string" ? so.id : makeId(),
      type: so.type,
      style: sanitizeSlotStyle(so.style),
      card: sanitizeCardStyle(so.card),
    });
  }
  return {
    version: 1,
    name: typeof o.name === "string" ? o.name.slice(0, 60) : "Custom",
    container: sanitizeContainerStyle(o.container),
    slots: launchColumns(slots),
  };
}

export function loadTemplate(): MonitorTemplate {
  if (typeof window === "undefined") return defaultTemplate();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizeTemplate(JSON.parse(raw));
  } catch {}
  return defaultTemplate();
}

export function saveTemplate(t: MonitorTemplate): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(t)); } catch {}
}

export function exportTemplate(t: MonitorTemplate): string {
  return JSON.stringify(t, null, 2);
}

export function importTemplate(json: string): MonitorTemplate | null {
  try { return sanitizeTemplate(JSON.parse(json)); } catch { return null; }
}
