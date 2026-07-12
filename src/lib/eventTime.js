// Some feeds give an event a start time but no end time. Without one, the app
// used to keep an event on the "today" list for ~12 hours after it started, so a
// noon concert lingered until midnight. This estimates a sensible end from the
// event's type so it drops off around when it would actually finish.

import { nyHour } from '../utils/dates.js';

// Estimated end, in ms, for an event that has no real end time.
export function estimatedEndMs(startISO, title = '', category = '') {
  const start = Date.parse(startISO);
  if (Number.isNaN(start)) return start;

  // An "all day / time unknown" event from the feed — keep it visible through the
  // rest of its Eastern day instead of ending it a few hours in. The aggregator
  // anchors all-day events to NOON Eastern (older data used a midnight anchor), and
  // leaves the end null, so treat BOTH anchors as all-day. This matches isOver() in
  // dates.js, which the list/calendar/map otherwise disagreed with — a noon-anchored
  // festival was dropping off the feed around 2pm on the very day it happened. nyHour
  // is Hermes-safe (no Intl), so this behaves identically on iOS and Android.
  const d0 = new Date(start);
  const hourET = nyHour(d0);
  // Only EXACT anchors count as all-day (the aggregator writes 12:00:00 sharp).
  // ET's offset is a whole number of hours, so ET minutes equal UTC minutes —
  // a genuine 12:30 PM matinee or 12:15 AM show keeps its timed estimate below
  // (and stays in agreement with isOver(), which also requires minute zero).
  const onTheHour = d0.getUTCMinutes() === 0;
  if (hourET === 12 && onTheHour) return start + 12 * 3600 * 1000; // noon ET -> end of the ET day
  if (hourET === 0 && onTheHour) return start + 24 * 3600 * 1000; // midnight ET -> end of the ET day

  const t = (title || '').toLowerCase();
  const cat = (category || '').toLowerCase();
  let hours;
  // Specific activity keywords first, so "County Fair Parade" reads as a parade
  // (1.5h), not the whole fair (4h). Broad venue-ish words (fair/market) last.
  if (/lunchtime|lunch\b|noon/.test(t)) hours = 1.5;
  else if (/parade/.test(t)) hours = 1.5;
  else if (/\b5k\b|fun run|\bmarathon\b/.test(t)) hours = 2;
  else if (/\brace\b|racing/.test(t)) hours = 2.5;
  else if (/bingo/.test(t)) hours = 2;
  else if (/storytime|story time|workshop|\bclass(es)?\b|meeting|board of|seminar|orientation/.test(t)) hours = 1.5;
  else if (/movie|film|screening/.test(t)) hours = 2.5;
  else if (/concert|live music|symphony|\bband\b|\bdj\b/.test(t)) hours = 2.5;
  else if (/\bvs\.?\b|\bgame\b|tournament|\bmatch\b/.test(t)) hours = 2.5;
  else if (/breakfast|brunch/.test(t)) hours = 2;
  else if (/dinner|banquet|\bgala\b|fundraiser/.test(t)) hours = 3;
  else if (/cruise/.test(t)) hours = 3;
  else if (/farmers?|market|bazaar/.test(t)) hours = 4;
  else if (/festival|\bfair\b|carnival/.test(t)) hours = 4;
  else if (cat === 'market') hours = 4;
  else if (cat === 'food') hours = 3;
  else if (cat === 'music' || cat === 'sports' || cat === 'arts') hours = 2.5;
  else if (cat === 'family' || cat === 'education') hours = 1.5;
  else hours = 2;

  return start + Math.min(6, Math.max(1, hours)) * 3600 * 1000;
}

// When an event is no longer "current": its real end if it has one, else an
// estimate. Used to decide whether an event still belongs on the list.
export function effectiveEndMs(startISO, endISO, title, category) {
  if (endISO) {
    const e = Date.parse(endISO);
    if (!Number.isNaN(e)) return e;
  }
  return estimatedEndMs(startISO, title, category);
}
