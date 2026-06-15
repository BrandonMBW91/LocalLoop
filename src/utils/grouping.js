import { daysFromNow } from './dates';

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
export function buildTimeSections({ items, getDays, isFeatured, toRenderItem }) {
  const featured = [];
  const buckets = { Today: [], Tomorrow: [], 'This Week': [], 'Next Week': [], Later: [] };
  items.forEach((it) => {
    if (isFeatured && isFeatured(it)) featured.push(it);
    else buckets[bucketForDays(getDays(it))].push(it);
  });

  let adIndex = 0;
  const withAds = (arr) => {
    const out = [];
    arr.forEach((it, i) => {
      out.push(toRenderItem(it));
      if ((i + 1) % 4 === 0 && i !== arr.length - 1) {
        out.push({ type: 'ad', key: `ad-${adIndex}`, adIndex });
        adIndex += 1;
      }
    });
    return out;
  };

  const ordered = [['Featured', featured], ...BUCKET_ORDER.map((b) => [b, buckets[b]])];
  return ordered
    .filter(([, arr]) => arr.length)
    .map(([title, arr]) => ({ title, count: arr.length, data: withAds(arr) }));
}
