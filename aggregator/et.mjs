// Shared Eastern-time conversions for the aggregator (server-side Node — the
// app's Hermes Intl ban does not apply here). One implementation so every
// connector agrees; a hardcoded "-04:00" is an EST-season bug (7pm stored as 6pm
// all winter), and server-local `new Date(y,m,d,12)` mints different all-day
// timestamps on CI (UTC) vs a local ET machine, breaking source_uid stability.
const ET = 'America/New_York';

export function wallParts(dt) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(dt);
  const g = (t) => Number((p.find((x) => x.type === t) || {}).value);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour') % 24, mi: g('minute'), s: g('second') };
}

// Eastern wall-clock (Y, M, D, h, m, s) → UTC Date. DST-correct. Two passes:
// the first guess uses the offset at the naive instant, the second re-reads the
// offset AT the guess — required to converge inside the spring-forward window.
export function etWallToDate(y, mo, d, h = 0, mi = 0, s = 0) {
  const target = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const w = wallParts(new Date(guess));
    const wall = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
    guess = guess - (wall - target);
  }
  return new Date(guess);
}

// "YYYY-MM-DD HH:MM(:SS)" / "YYYY-MM-DDTHH:MM(:SS)" Eastern wall-clock → UTC Date.
export function etToDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(str || '');
  if (!m) return null;
  const [, Y, Mo, D, h, mi, s] = m.map(Number);
  return etWallToDate(Y, Mo, D, h, mi, s || 0);
}

// Noon EASTERN on the calendar day this date falls on (in ET). Used to anchor
// all-day events: fixed-zone, so the same event hashes to the same source_uid
// whether the run happens on UTC CI or the owner's ET machine.
export function etNoon(d) {
  const w = wallParts(d);
  return etWallToDate(w.y, w.mo, w.d, 12, 0, 0);
}
