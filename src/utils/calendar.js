// Build an "Add to Calendar" link. Uses Google Calendar's template URL, which
// opens the user's calendar app on a phone (or the web calendar) — no native
// module required, so it works in Expo Go, the web preview, and production.
//
// Date handling matters here: garage sales and food trucks store DATE-ONLY
// strings ("2026-07-10") plus human clock text ("3 PM"). A raw new Date() parsed
// those as UTC midnight, so "Add to Calendar" booked the PREVIOUS evening 8 PM
// ET. We now parse with the shared local-midnight parse(), combine the posted
// clock times when given, and fall back to a true all-day calendar entry (never
// a fake 12:00 block) when no time is known — including the aggregator's
// all-day-anchored events.

import { parse, isAllDayAnchor } from './dates';

const isDateOnly = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());

// "3 PM" / "10:30 am" / "12 PM" → { h, m } in local 24h. null when unparseable.
function clockToHM(s) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?/i.exec(String(s || ''));
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (/p/i.test(m[3])) h += 12;
  return { h, m: m[2] ? parseInt(m[2], 10) : 0 };
}

function toUTCBasic(d) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

// Local calendar date → Google's all-day form (YYYYMMDD).
function toAllDayBasic(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export function addToCalendarUrl({ title, start, end, location, details, startTime, endTime }) {
  const dateOnly = isDateOnly(start);
  const startD = parse(start);
  const endBase = end ? parse(end) : startD;
  let dates;

  const st = dateOnly ? clockToHM(startTime) : null;
  if (st) {
    // Date-only listing WITH posted hours (trucks/sales): real timed entry.
    const s = new Date(startD);
    s.setHours(st.h, st.m, 0, 0);
    const et = clockToHM(endTime);
    let e;
    if (et) {
      e = new Date(endBase);
      e.setHours(et.h, et.m, 0, 0);
      if (e <= s) e = new Date(s.getTime() + 2 * 3600 * 1000);
    } else {
      e = new Date(s.getTime() + 2 * 3600 * 1000);
    }
    dates = `${toUTCBasic(s)}/${toUTCBasic(e)}`;
  } else if (dateOnly || isAllDayAnchor(start, end)) {
    // No usable time → a true all-day entry (end date is exclusive in Google).
    const ex = new Date(endBase.getFullYear(), endBase.getMonth(), endBase.getDate() + 1);
    dates = `${toAllDayBasic(startD)}/${toAllDayBasic(ex)}`;
  } else {
    // Timed event. Default to a 2-hour block when there's no explicit end.
    const endD = end ? parse(end) : new Date(startD.getTime() + 2 * 60 * 60 * 1000);
    dates = `${toUTCBasic(startD)}/${toUTCBasic(endD)}`;
  }

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title || 'Event',
    dates,
    location: location || '',
    details: details || '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
