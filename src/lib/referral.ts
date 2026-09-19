// Referral-code capture. A ?ref=<code> link drops an 8-char code that we stash
// in localStorage (authoritative — survives the Privy redirect/popup remount)
// until the next signup, then thread into the login call and clear.

const REF_KEY = "spool.referralCode";

function isValidCode(code: string): boolean {
  return /^[A-Z0-9]{8}$/.test(code);
}

/** Read ?ref= from the current URL and persist it (call once on app boot). */
export function captureReferralFromUrl(): void {
  try {
    const raw = new URLSearchParams(window.location.search).get("ref");
    if (!raw) return;
    const code = raw.trim().toUpperCase();
    if (isValidCode(code)) localStorage.setItem(REF_KEY, code);
  } catch {
    /* ignore */
  }
}

/** Current stored referral code (or undefined). Does not clear it. */
export function peekReferralCode(): string | undefined {
  try {
    const code = localStorage.getItem(REF_KEY)?.trim().toUpperCase();
    return code && isValidCode(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

/** Clear the stored referral code (call after a successful signup). */
export function clearReferralCode(): void {
  try {
    localStorage.removeItem(REF_KEY);
  } catch {
    /* ignore */
  }
}
