// Standalone module so the wire singleton can read the session key without
// importing backend.ts (which imports the wire singleton — that cycle put
// the bundle into a TDZ at boot, manifesting as
// "Cannot access 'i' before initialization" in the layout chunk).

export const SESSION_STORAGE_KEY = "trade.session";
export const SESSION_CHANGED_EVENT = "terminal:session-changed";
