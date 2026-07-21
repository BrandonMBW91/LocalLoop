// Explicit .js so plain Node can import this file and the ad-placement logic can be
// tested for real. Metro resolves an explicit extension identically; the tests used to
// hand-mirror bucketForDays instead, which is the kind of copy that drifts.
import { daysFromNow } from './dates.js';

// Friendly time buckets shared by the Events, Garage Sales, and Food Trucks
// lists, so a long list stays scannable under sticky headers.
export const BUCKET_ORDER = ['Today', 'Tomorrow', 'This Week', 'Next Week', 'Later'];

export function bucketForDays(d) {
  if (d <= 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d <= 6) return 'This Week';
  if (d <= 13) return 'Next Week';
  return 'Later';
}

// Build SectionList sections from a flat list: Featured pinned first, then time
// buckets, with an ad interleaved after every 4 cards.
//   items        - the filtered array
//   getDays      - (item) => whole days from now (0 = today)
//   isFeatured   - (item) => boolean (optional)
//   toRenderItem - (item) => the card render object (must include a unique `key`)
//   injectAds    - interleave ad slots after every 4 cards (default false; the
//                  caller passes true only when a real sponsor exists, so we
//                  never leave an empty slot where the placeholder used to be)
export function buildTimeSections({ items, getDays, isFeatured, toRenderItem, injectAds = false }) {
  const featured = [];
  const buckets = { Today: [], Tomorrow: [], 'This Week': [], 'Next Week': [], Later: [] };
  items.forEach((it) => {
    if (isFeatured && isFeatured(it)) featured.push(it);
    else buckets[bucketForDays(getDays(it))].push(it);
  });

  // Within Today, things STARTING today lead; ongoing carry-overs (multi-day
  // runs already in progress, whose start is days or months old) follow. The
  // list arrives sorted by start time, which put a February-started promo above
  // today's real events every single day. Stable sort keeps time order inside
  // each group.
  buckets.Today.sort((a, b) => (getDays(a) === 0 ? 0 : 1) - (getDays(b) === 0 ? 0 : 1));

  // Ads are placed every 4th item across the WHOLE feed, not per section.
  //
  // This used to count within each bucket, so a bucket needed 5+ items before it could
  // emit even one ad. A town with 4 events today, 3 tomorrow and 4 this week showed
  // ZERO ads — 11 events and no placement at all. Those are precisely the small towns
  // on the $19 tier, so the advertisers most likely to get nothing for their money were
  // the ones paying the entry price, while the advertise page promised "your ad shown
  // between listings in your town".
  //
  // adIndex keeps advancing across sections (it always did), which is what rotates
  // multiple sponsors through the slots rather than showing the first one every time.
  let adIndex = 0;
  let placed = 0; // items emitted so far across every section
  const withAds = (arr, isLastSection) => {
    const out = [];
    arr.forEach((it, i) => {
      out.push(toRenderItem(it));
      placed += 1;
      // Never end the entire feed on an ad. Between sections is fine; dangling off the
      // bottom reads as the list having run out of events.
      const endOfFeed = isLastSection && i === arr.length - 1;
      if (injectAds && placed % 4 === 0 && !endOfFeed) {
        out.push({ type: 'ad', key: `ad-${adIndex}`, adIndex });
        adIndex += 1;
      }
    });
    return out;
  };

  const ordered = [['Featured', featured], ...BUCKET_ORDER.map((b) => [b, buckets[b]])]
    .filter(([, arr]) => arr.length);
  return ordered.map(([title, arr], si) => ({
    title,
    count: arr.length,
    data: withAds(arr, si === ordered.length - 1),
  }));
}
