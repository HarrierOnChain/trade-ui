/** Chart resolution string → bar period in milliseconds. */
export function resolutionToMs(resolution: string): number {
  switch (resolution) {
    case "1S": return 1_000;
    case "5S": return 5_000;
    case "15S": return 15_000;
    case "30S": return 30_000;
    case "1": return 60_000;
    case "5": return 5 * 60_000;
    case "15": return 15 * 60_000;
    case "30": return 30 * 60_000;
    case "60": return 60 * 60_000;
    case "240": return 4 * 60 * 60_000;
    case "1D": return 24 * 60 * 60_000;
    default: return 60_000;
  }
}

/** Inclusive bar window for a chart right-click at `unixTime` (seconds or ms). */
export function barRangeFromChartTime(
  unixTime: number,
  resolution: string,
): { minMs: number; maxMs: number } {
  const tMs = unixTime < 1e12 ? unixTime * 1000 : unixTime;
  const periodMs = resolutionToMs(resolution);
  const barStart = Math.floor(tMs / periodMs) * periodMs;
  return { minMs: barStart, maxMs: barStart + periodMs - 1 };
}

export function msToDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseDatetimeLocal(value: string): number | null {
  if (!value.trim()) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

export function formatTimestampRangeShort(minMs: number, maxMs: number): string {
  const fmt = (ms: number) => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const sameDay =
    new Date(minMs).toDateString() === new Date(maxMs).toDateString();
  if (sameDay) return `${fmt(minMs)}–${fmt(maxMs)}`;
  const day = (ms: number) => {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  return `${day(minMs)} ${fmt(minMs)} – ${day(maxMs)} ${fmt(maxMs)}`;
}
