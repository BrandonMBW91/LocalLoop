// Lightweight date formatting helpers (no external date library needed).

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function parse(value) {
  if (value instanceof Date) return value;
  // Date-only strings ("2026-06-19") are parsed as UTC midnight by JS, which
  // renders as the PREVIOUS day in negative-offset zones (e.g. US Eastern).
  // Force local-midnight parsing for these.
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(value);
}

export function formatTime(value) {
  const d = parse(value);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const mm = m === 0 ? '' : ':' + String(m).padStart(2, '0');
  return `${h}${mm} ${ampm}`;
}

// "Sat, Jun 20"
export function formatShortDate(value) {
  const d = parse(value);
  return `${DAYS[d.getDay()].slice(0, 3)}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

// "Saturday, June 20, 2026"
export function formatLongDate(value) {
  const d = parse(value);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// "Wednesday, July 8" — weekday + month + day, no year (calendar day heading).
// Built from getDay()/getMonth() so it's correct on Android's Hermes engine,
// whose Intl / toLocaleDateString support is unreliable and can return the wrong
// weekday. Use these helpers instead of toLocaleDateString anywhere in the app.
export function formatDayHeading(value) {
  const d = parse(value);
  if (isNaN(d)) return '';
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// "Jul 8, 2026" — month + day + year, no weekday. Hermes-safe (no Intl).
export function formatDateMedium(value) {
  const d = parse(value);
  if (isNaN(d)) return '';
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`;
}

// Friendly relative label for grouping/badges: Today, Tomorrow, or short date.
export function relativeDay(value, now = new Date()) {
  const d = parse(value);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((a - b) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays > 1 && diffDays < 7) return DAYS[d.getDay()];
  return formatShortDate(value);
}

// True for a multi-day event that is CURRENTLY running but started on an earlier
// day (exhibitions, month-long specials). Such events otherwise show their past
// start date, which reads as stale — the card labels them "Happening now" instead.
export function isOngoing(start, end, now = new Date()) {
  if (!end) return false;
  const s = parse(start), e = parse(end);
  if (isNaN(s) || isNaN(e)) return false;
  if (!(s < now && e > now)) return false; // must span the present moment
  return toDateString(s) !== toDateString(now); // and have started before today
}

// Parts for a small calendar-style date chip: { weekday:'SAT', day:15, month:'Jun' }.
export function calendarBits(value) {
  const d = parse(value);
  return {
    weekday: DAYS[d.getDay()].slice(0, 3).toUpperCase(),
    day: d.getDate(),
    month: MONTHS[d.getMonth()].slice(0, 3),
  };
}

export function timeRange(start, end) {
  if (!end) return formatTime(start);
  return `${formatTime(start)} to ${formatTime(end)}`;
}

// "Sat, Jun 20" for one day, or "Fri, Jun 19 – Sat, Jun 20" for a range.
export function dateRangeLabel(start, end) {
  if (!end || toDateString(start) === toDateString(end)) return formatShortDate(start);
  return `${formatShortDate(start)} to ${formatShortDate(end)}`;
}

// Format a Date as a local "YYYY-MM-DD" string (for date-only storage).
export function toDateString(value) {
  const d = parse(value);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// All-day/time-unknown detection, shared by every RENDERER. The aggregator
// anchors these at NOON ET with no end (older data: midnight ET spanning to
// ~23:59 ET). isOver() and estimatedEndMs() already detect the anchors to time
// events OUT correctly, but the display paths were printing the literal anchor —
// "12 PM", or "12 AM to 11:59 PM" — so an all-day farmers market read like a
// noon meeting. Same rules as those two functions so filters and labels agree.
export function isAllDayAnchor(start, end) {
  const s = parse(start);
  if (isNaN(s) || s.getUTCMinutes() !== 0) return false;
  const h = nyHour(s);
  if (h === 12 && !end) return true; // noon-ET anchor, end unknown
  if (h === 0) {
    if (!end) return true; // midnight-ET anchor, end unknown
    const e = parse(end);
    if (isNaN(e)) return false;
    const span = e.getTime() - s.getTime();
    return span >= 23.5 * 3600 * 1000 && span <= 24.5 * 3600 * 1000; // ~23:59 same ET day
  }
  return false;
}

// The clock part of an event label: "All day" for anchor events, else the
// real time or range. Use this instead of raw timeRange on display surfaces.
export function timeLabel(start, end) {
  return isAllDayAnchor(start, end) ? 'All day' : timeRange(start, end);
}

// True once an event has finished and should drop off the lists. Uses the end
// time when it's known; for events with no end time it keeps a few hours of
// grace (so a happening-now event doesn't vanish), and keeps all-day events
// (anchored to local noon by the aggregator) through the rest of their day.
export function isOver(start, end, now = new Date()) {
  if (end) return parse(end).getTime() <= now.getTime();
  const s = parse(start);
  if (isNaN(s)) return false;
  // Noon-ET all-day anchor (the aggregator writes 12:00:00 ET sharp): over at
  // the end of its EASTERN day, start + 12h — exactly what eventTime's
  // effectiveEndMs returns, so the two filters can never disagree. Detection is
  // ET-based (nyHour) rather than device-local so a phone outside Eastern time
  // agrees with the feed; ET minutes equal UTC minutes (whole-hour offset).
  if (nyHour(s) === 12 && s.getUTCMinutes() === 0) {
    return s.getTime() + 12 * 3600 * 1000 <= now.getTime();
  }
  return s.getTime() + 3 * 60 * 60 * 1000 <= now.getTime();
}

// The current/upcoming weekend window (Fri 00:00 → Sun 23:59). On Sat/Sun it's
// the weekend in progress; Mon–Fri it's the one coming up.
export function thisWeekendRange(now = new Date()) {
  const dow = now.getDay(); // 0=Sun … 6=Sat
  let toFri;
  if (dow === 0) toFri = -2; // Sunday → Friday was 2 days ago
  else if (dow === 6) toFri = -1; // Saturday → Friday was yesterday
  else toFri = 5 - dow; // Mon–Fri → the coming Friday
  const fri = new Date(now.getFullYear(), now.getMonth(), now.getDate() + toFri, 0, 0, 0);
  const sunEnd = new Date(fri.getFullYear(), fri.getMonth(), fri.getDate() + 2, 23, 59, 59);
  return [fri, sunEnd];
}

export function isThisWeekend(value, now = new Date()) {
  const t = parse(value).getTime();
  const [a, b] = thisWeekendRange(now);
  return t >= a.getTime() && t <= b.getTime();
}

// Chip filters were start-only, so a running festival vanished from "Today" and
// a Fri–Sun fair never matched "Weekend" after Friday. These treat an event as
// matching when any part of its run touches the window.
export function touchesToday(start, end, now = new Date()) {
  const ds = daysFromNow(start, now);
  if (ds === 0) return true;
  if (ds > 0 || !end) return false;
  return daysFromNow(end, now) >= 0 && !isOver(start, end, now);
}

export function touchesWeekend(start, end, now = new Date()) {
  const [a, b] = thisWeekendRange(now);
  const s = parse(start).getTime();
  const e = end ? parse(end).getTime() : s;
  return s <= b.getTime() && e >= a.getTime();
}

// Number of whole days from `now` to a date (0 = today, 1 = tomorrow).
export function daysFromNow(value, now = new Date()) {
  const d = parse(value);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

// --- America/New_York helpers (Hermes-safe: NO Intl / timeZone) ----------------
// Android's Hermes engine has unreliable Intl/ICU (it returned the wrong weekday
// from toLocaleDateString), so we compute Eastern time from the US DST rules
// rather than Intl.DateTimeFormat({ timeZone }). Local Loop is an Ohio app, so ET
// is the right anchor for "today" and all-day detection on both platforms.

// Eastern UTC offset in hours for an instant: -4 (EDT) between the 2nd Sunday of
// March 02:00 and the 1st Sunday of November 02:00, else -5 (EST).
export function nyOffsetHours(date) {
  const y = date.getUTCFullYear();
  const nthSunday = (month, nth) => {
    const firstDow = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return 1 + ((7 - firstDow) % 7) + (nth - 1) * 7;
  };
  const dstStart = Date.UTC(y, 2, nthSunday(2, 2), 7); // 2nd Sun Mar, 2:00 EST = 07:00 UTC
  const dstEnd = Date.UTC(y, 10, nthSunday(10, 1), 6); // 1st Sun Nov, 2:00 EDT = 06:00 UTC
  const t = date.getTime();
  return t >= dstStart && t < dstEnd ? -4 : -5;
}

// Hour of day (0-23) in Eastern time for an instant.
export function nyHour(date) {
  return (date.getUTCHours() + nyOffsetHours(date) + 24) % 24;
}

// "YYYY-MM-DD" for an instant in Eastern time (defaults to now).
export function nyDateKey(date = new Date()) {
  const shifted = new Date(date.getTime() + nyOffsetHours(date) * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}`;
}

// Thousands-grouped integer ("1,234") without Intl.NumberFormat (Hermes-safe).
export function formatCount(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
