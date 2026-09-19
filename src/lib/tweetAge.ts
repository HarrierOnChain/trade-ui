// Tweet freshness — shared by the small X icon (TokenSocialLinks) and the
// hover preview (XLinkPreview) so both use the exact same age → color mapping.
//
// Twitter/X snowflake IDs encode the post time (epoch 2010-11-04), so we can
// derive a tweet's age from the ID alone — no fetch. BigInt is required: tweet
// IDs exceed Number.MAX_SAFE_INTEGER.

export const TWEET_FRESH = "#4bd18b"; // green  — < 15 min
export const TWEET_MID = "#f5a623"; //   orange — 15–60 min
export const TWEET_OLD = "#f0505a"; //   red    — ≥ 60 min

export const TWEET_MID_MIN = 15;
export const TWEET_OLD_MIN = 60;

const X_EPOCH_MS = 1288834974657;

export function tweetAgeMinutesFromId(tweetId: string | null | undefined): number | null {
  if (!tweetId || !/^[0-9]+$/.test(tweetId)) return null;
  try {
    const postedMs = Number((BigInt(tweetId) >> 22n) + BigInt(X_EPOCH_MS));
    if (!Number.isFinite(postedMs) || postedMs <= 0) return null;
    return (Date.now() - postedMs) / 60000;
  } catch {
    return null;
  }
}

export function tweetAgeMinutesFromDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 60000;
}

export function tweetFreshnessColor(ageMinutes: number | null | undefined): string {
  if (ageMinutes == null) return TWEET_FRESH;
  if (ageMinutes < TWEET_MID_MIN) return TWEET_FRESH;
  if (ageMinutes < TWEET_OLD_MIN) return TWEET_MID;
  return TWEET_OLD;
}
