/** Accent palette for wallet avatars — stable per row index. */
export const WALLET_AVATAR_PALETTE = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#06b6d4", "#3b82f6",
] as const;

export function walletInitials(label: string): string {
  const parts = label.replace(/[^a-zA-Z0-9]/g, " ").trim().split(/\s+/);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return label.slice(0, 2).toUpperCase() || "?";
}

function isEmojiGrapheme(s: string): boolean {
  return /\p{Extended_Pictographic}/u.test(s);
}

export function walletDisplayGlyph(label: string): string {
  return walletInitials(label);
}

export function walletAvatarColor(index: number): string {
  return WALLET_AVATAR_PALETTE[index % WALLET_AVATAR_PALETTE.length];
}

export function walletAvatarFontSize(glyph: string, size: number): number {
  if (isEmojiGrapheme(glyph)) return Math.round(size * 0.52);
  return glyph.length > 1 ? Math.round(size * 0.32) : Math.round(size * 0.38);
}
