// LibraryMarket "LC Events" (Drupal) — county library systems on
// {sub}.librarycalendar.com. Free, key-free JSON feed.
//   event_sources row: type 'librarymarket', url = host (e.g.
//   https://medinacounty.librarycalendar.com), city_id = fallback town.
// Branch addresses ride in each event's location string, so the town router
// sends "Boardman Branch" events to Boardman even on a county-wide source.

// Strip tags only — do NOT eat HTML entities here: makeRow's shared cleanText/
// cleanDescription decode them properly, and replacing them with spaces first
// destroyed apostrophes/quotes in published titles ("Ohio s Birds").
const clean = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const first = (o) => (o && typeof o === 'object' ? Object.values(o)[0] : '') || '';

// Library-local wall-clock ("2026-07-01 16:30:00") in a named tz → UTC Date,
// DST-correct (Node's Intl on the SERVER is fine — the Hermes ban is app-only).
function localToDate(local, tz = 'America/New_York') {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(local || '');
  if (!m) return null;
  const [, Y, Mo, D, h, mi] = m.map(Number);
  const asUTC = Date.UTC(Y, Mo - 1, D, h, mi, 0);
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(asUTC));
  const gp = (t) => Number((p.find((x) => x.type === t) || {}).value);
  const tzWall = Date.UTC(gp('year'), gp('month') - 1, gp('day'), gp('hour') % 24, gp('minute'), gp('second'));
  return new Date(asUTC - (tzWall - asUTC));
}

export async function pull(source, { floor, cutoff }) {
  const host = source.url.replace(/\/+$/, '');
  const start = new Date(floor).toISOString().slice(0, 10);
  const end = new Date(cutoff).toISOString().slice(0, 10);
  const url = `${host}/events/feed/json?_wrapper_format=lc_calendar_feed&start=${start}&end=${end}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (LocalLoop aggregator)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('not a JSON array (feed shape changed)');

  const out = [];
  for (const e of data) {
    if (e.type !== 'lc_event' || e.public === false) continue;
    const startD = localToDate(e.start_date, e.timezone);
    const title = clean(e.title);
    if (!title || !startD) continue;
    const branch = first(e.branch);
    const room = first(e.room);
    const offsite = clean(e.offsite_address || '');
    const isOff = /off ?site/i.test(branch);
    // "Venue (room), address" — deriveVenue in makeRow splits the address back out
    // at the first street-number segment (name-led strings keep the room text).
    const location = isOff && offsite ? offsite : `${branch || source.name}${room ? ` (${room})` : ''}`;
    out.push({
      summary: title,
      description: clean(e.description),
      location,
      url: /^https:\/\//.test(e.url || '') ? e.url : null,
      image: /^https:\/\//.test(e.image || '') ? e.image : null,
      start: startD,
      end: e.end_date ? localToDate(e.end_date, e.timezone) : null,
    });
  }
  return out;
}
