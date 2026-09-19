// Shared age display registry — ONE setInterval for every time display on the page.
// Components register their DOM element + timestamp; the interval updates them directly,
// bypassing React's scheduler entirely.

const _registry = new Map<HTMLElement, number>(); // element → tsMs
// Countdowns: element → { absolute deadline ms, optional `expired` text }.
// Uses the same 1Hz interval so adding mayhem-style 24h timers doesn't
// spawn a second timer loop.
const _countdownRegistry = new Map<
  HTMLElement,
  { deadlineMs: number; expiredText: string; showSeconds: boolean }
>();
let _interval: ReturnType<typeof setInterval> | null = null;

function ensureInterval() {
  if (_interval) return;
  _interval = setInterval(() => {
    _registry.forEach((ms, node) => { node.textContent = formatAge(ms); });
    _countdownRegistry.forEach((cfg, node) => {
      node.textContent = formatCountdown(cfg.deadlineMs, cfg.expiredText, cfg.showSeconds);
    });
  }, 1000);
}

function maybeStopInterval() {
  if (_registry.size === 0 && _countdownRegistry.size === 0 && _interval !== null) {
    clearInterval(_interval);
    _interval = null;
  }
}

export function formatAge(tsMs: number): string {
  if (isNaN(tsMs)) return "–";
  const sec = Math.floor((Date.now() - tsMs) / 1000);
  if (sec < 0)      return "now";
  if (sec < 60)     return `${sec}s`;
  if (sec < 3600)   return `${Math.floor(sec / 60)}m`;
  if (sec < 86400)  return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

// HH:MM:SS until `deadlineMs`. Returns `expiredText` once the deadline
// passes so callers can decide what to render after the timer ends.
export function formatCountdown(
  deadlineMs: number,
  expiredText = "00:00:00",
  showSeconds = true,
): string {
  if (!Number.isFinite(deadlineMs)) return expiredText;
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) return expiredText;
  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  if (!showSeconds) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const s = Math.floor((remaining % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function registerAge(el: HTMLElement, tsMs: number): void {
  _registry.set(el, tsMs);
  ensureInterval();
}

export function unregisterAge(el: HTMLElement): void {
  _registry.delete(el);
  maybeStopInterval();
}

export function registerCountdown(
  el: HTMLElement,
  deadlineMs: number,
  expiredText = "00:00:00",
  showSeconds = true,
): void {
  _countdownRegistry.set(el, { deadlineMs, expiredText, showSeconds });
  ensureInterval();
}

export function unregisterCountdown(el: HTMLElement): void {
  _countdownRegistry.delete(el);
  maybeStopInterval();
}
