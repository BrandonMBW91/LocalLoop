// Lightweight date formatting helpers (no external date library needed).

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parse(value) {
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
  return `${formatTime(start)} – ${formatTime(end)}`;
}

// "Sat, Jun 20" for one day, or "Fri, Jun 19 – Sat, Jun 20" for a range.
export function dateRangeLabel(start, end) {
  if (!end || toDateString(start) === toDateString(end)) return formatShortDate(start);
  return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

// Format a Date as a local "YYYY-MM-DD" string (for date-only storage).
export function toDateString(value) {
  const d = parse(value);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Number of whole days from `now` to a date (0 = today, 1 = tomorrow).
export function daysFromNow(value, now = new Date()) {
  const d = parse(value);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}
