/** Deterministic FNV-1a hash for seeding random number generators. */
export function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h = (h ^ str.charCodeAt(i)) * 16777619;
  }
  return h >>> 0;
}

/** Linear-congruential generator. Returns a function yielding [0,1). */
export function rnd(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Pick a random element from an array. */
export function pick<T>(arr: T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length)];
}

/** Generate a pseudo-Solana mint address (44 base58-ish chars). */
export function fakeAddress(r: () => number, prefix = "So"): string {
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const len = 44 - prefix.length;
  let out = prefix;
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(r() * alphabet.length)];
  return out;
}
