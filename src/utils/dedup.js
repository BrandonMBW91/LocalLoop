// Lightweight duplicate detection for user-submitted events. Community events
// (fireworks, festivals, fairs) are the ones residents tend to re-post when a
// feed or a neighbor already has them; garage sales / food trucks are unique to
// one person and don't need this. Runs client-side against the town's already-
// loaded approved events, so it's a soft "is this the same?" nudge, not a block.

import { parse } from './dates';

// Common words that carry no identifying signal for matching.
const STOP = new Set([
  'the', 'and', 'a', 'an', 'at', 'of', 'in', 'on', 'to', 'for', 'with', 'our',
  'your', 'this', 'that', 'event', 'events', 'annual', 'day', 'night', 'presents',
  'featuring', 'live', 'free', 'findlay', 'ohio', 'community', 'center', 'series',
]);

export function eventTokens(title) {
  return new Set(
    String(title || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOP.has(t))
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// A distinctive shared token (>= 5 chars) is a strong signal even when the rest
// of the wording differs — e.g. "City Fireworks" vs "Findlay Balloonfest
// Fireworks" both share "fireworks".
function sharesDistinctiveToken(a, b) {
  for (const t of a) if (t.length >= 5 && b.has(t)) return true;
  return false;
}

function daysApart(isoA, isoB) {
  const a = parse(isoA);
  const b = parse(isoB);
  if (isNaN(a) || isNaN(b)) return Infinity;
  return Math.abs((a - b) / 86400000);
}

// Returns the most likely already-posted match for a candidate event, or null.
// `events` should be the town's approved events (already city-scoped in context).
export function findDuplicateEvent(candidate, events) {
  const myTokens = eventTokens(candidate?.title);
  if (!myTokens.size) return null;
  let best = null;
  let bestScore = 0;
  for (const e of events || []) {
    if (!e || e.id === candidate.id) continue;
    const d = daysApart(candidate.start, e.start);
    if (d > 1.5) continue; // must be within ~a day to be the same occurrence
    const otherTokens = eventTokens(e.title);
    const sim = jaccard(myTokens, otherTokens);
    const distinctive = sharesDistinctiveToken(myTokens, otherTokens);
    if (sim >= 0.5 || distinctive) {
      const score = sim + (distinctive ? 0.5 : 0) + (d <= 0.5 ? 0.2 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
  }
  return best;
}
