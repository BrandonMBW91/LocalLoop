// Simpleview CMS — destination-marketing (CVB) event calendars. Verified against
// shoresandislands.com (Lake Erie Shores & Islands: Port Clinton, Put-in-Bay,
// Kelleys Island, Catawba, Marblehead, Sandusky — 296 events/month in July).
//   event_sources row: type 'simpleview', url = the site (e.g.
//   https://www.shoresandislands.com), city_id = fallback town.
//
// API (live-verified 2026-07): two GETs, no auth.
//   1. token: GET {host}/plugins/core/get_simple_token/  → bare 32-hex token
//   2. GET {host}/includes/rest_v2/plugins_events_events_by_date/find/?json=...&token=...
// Gotchas the API enforces (500s otherwise): date_range start/end MUST be
// midnight IN THE SITE'S LOCAL (Eastern) TIMEZONE expressed as a UTC $date, and
// options.fields (a projection) MUST be present (200KB response cap).
// Recurrence: one doc per event, `date` = first occurrence in range; the daily
// cron naturally picks up later occurrences as they become "next".

const UA = { 'User-Agent': 'Mozilla/5.0 (LocalLoop aggregator)' };
const trim = (s) => String(s || '').trim();
const ET = 'America/New_York';

// Parts of an instant in Eastern time.
function etParts(dt) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(dt);
  const g = (t) => Number((p.find((x) => x.type === t) || {}).value);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour') % 24, mi: g('minute') };
}

// Eastern wall-clock (Y,M,D,h,m) → UTC Date, DST-correct.
function etDate(y, mo, d, h = 0, mi = 0, s = 0) {
  const asUTC = Date.UTC(y, mo - 1, d, h, mi, s);
  const w = etParts(new Date(asUTC));
  const wall = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  return new Date(asUTC - (wall - Date.UTC(y, mo - 1, d, h, mi)));
}

const FIELDS = {
  recid: 1, title: 1, date: 1, startDate: 1, endDate: 1, startTime: 1, endTime: 1,
  location: 1, hostname: 1, address1: 1, city: 1, state: 1, zip: 1,
  latitude: 1, longitude: 1, description: 1, media_raw: 1, url: 1, absoluteUrl: 1,
};

export async function pull(source, { floor, cutoff }) {
  const host = source.url.replace(/\/+$/, '');

  const tokenRes = await fetch(`${host}/plugins/core/get_simple_token/`, { headers: UA });
  if (!tokenRes.ok) throw new Error(`token HTTP ${tokenRes.status}`);
  const token = (await tokenRes.text()).trim();
  if (!/^[0-9a-f]{16,64}$/i.test(token)) throw new Error('token endpoint returned non-token');

  // ET-midnight range boundaries expressed as UTC $dates (the API's requirement).
  const f = etParts(new Date(floor));
  const c = etParts(new Date(cutoff));
  const startISO = etDate(f.y, f.mo, f.d).toISOString();
  const endISO = etDate(c.y, c.mo, c.d).toISOString();

  const out = [];
  for (let skip = 0, total = Infinity; skip < total && skip < 2000; skip += 50) {
    const body = {
      filter: { date_range: { start: { $date: startISO }, end: { $date: endISO } } },
      options: { limit: 50, skip, count: true, castDocs: false, fields: FIELDS, sort: { date: 1, rank: 1, title_sort: 1 } },
    };
    const url = `${host}/includes/rest_v2/plugins_events_events_by_date/find/?json=${encodeURIComponent(JSON.stringify(body))}&token=${token}`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const docs = data?.docs?.docs || [];
    total = data?.docs?.count ?? docs.length;

    for (const e of docs) {
      if (!e?.title || !e.date) continue;
      // `date` is a UTC instant pinned to 23:59:59 ET ON the occurrence day —
      // recover the ET calendar day, then combine with the local start/end times.
      const dp = etParts(new Date(e.date));
      const st = /^(\d{2}):(\d{2})/.exec(e.startTime || '');
      const en = /^(\d{2}):(\d{2})/.exec(e.endTime || '');
      const start = st ? etDate(dp.y, dp.mo, dp.d, +st[1], +st[2]) : etDate(dp.y, dp.mo, dp.d, 12, 0);
      const end = en ? etDate(dp.y, dp.mo, dp.d, +en[1], +en[2]) : null;
      const location = [trim(e.location), trim(e.address1), trim(e.city), `${trim(e.state)} ${trim(e.zip)}`.trim()]
        .filter(Boolean).join(', ');
      out.push({
        summary: trim(e.title),
        description: String(e.description || ''),
        location,
        url: /^https:\/\//.test(e.absoluteUrl || '') ? e.absoluteUrl : (e.url ? host + e.url : null),
        image: e.media_raw?.[0]?.mediaurl || null,
        start,
        end: end && end > start ? end : null,
      });
    }
    if (!docs.length) break;
  }
  return out;
}
