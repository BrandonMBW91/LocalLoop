// BaseLocal (baselocal.com) — a Next.js aggregator that republishes local events
// it collects mostly from Facebook Events (~93%), plus a few from ActiveKids /
// Eventbrite. Covers 13 Ohio metros: akron, canton, cincinnati, columbus, dayton,
// erie-county, findlay, lima, lorain, mansfield, springfield, toledo, youngstown.
//   event_sources row: type 'baselocal', url = a city events page
//     (https://baselocal.com/oh/springfield/events/), city_id = that city.
//
// WHY: ~90% of these are Facebook-only community events (breweries, small orgs,
// meetups, pop-ups) that publish NOWHERE else — no iCal/RSS exists, and Facebook's
// public-events API has been locked down since 2018, so this is the only practical
// way to reach them. We keep each event's original `url` (usually the Facebook
// permalink) as its ticket_url so users can verify the real details at the source.
//
// HOW: the events are server-embedded in the page HTML as Next.js RSC flight data
// (self.__next_f.push chunks). A plain desktop-UA GET returns the full, un-paginated
// set (~200 events, ~3-month horizon) as an "initialEvents" JSON array. No key, no
// browser, no scroll/API.  Fields per event: id, slug, name, date (YYYY-MM-DD),
// time (free text "7:00 PM – 8:30 PM" or ""), venue, category, description,
// longDescription, url.
//
// TOWN BLEED (important): BaseLocal buckets a whole region into its nearest covered
// city, so ~1 in 4 events on a city page are physically in a neighboring town
// (Springfield's page carries London / Yellow Springs / Urbana events). The event's
// only location signal is the free-text `venue`, which names the town only some of
// the time. We pass `venue` through as `location` so makeRow's town router sends a
// venue that names a served town to THAT town, and drops one that names an unserved
// town — the rest (bare venue names) fall back to this source's city_id. Residual
// bleed is limited to bare-venue events in nearby towns; the shared source_uid +
// dedupe sweep handles any overlap with our first-party feeds.

import { etToDate } from '../et.mjs';

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LocalLoop aggregator' };
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// BaseLocal buckets a whole region into its nearest covered city, so a city page
// carries events physically in nearby towns. cityFromLocation already DROPS those
// whose venue carries a ", OH" address and routes ones that name a SERVED neighbor
// (Springfield's page correctly sends its Urbana events to Urbana). What slips
// through is bare venue names in UNSERVED neighbors ("Yellow Springs Brewery",
// "Trail Town Brewing"), which would fall back to the page's city. This per-city
// denylist drops those so a town stays clean; matched on venue+title. Extend it
// with each BaseLocal city we wire (leave a city out = permissive fallback).
// Served neighbors are deliberately absent — makeRow routes those correctly.
const BLEED_TOWNS = {
  springfield: /yellow springs|\blondon\b|madison county|antioch college|glen helen|trail town brewing|foundry theater|coactive|grimes field|champaign aviation|freshwater farm/i,
};

// Reassemble the RSC flight stream from the page's self.__next_f pushes, then
// fall back to naively unescaping the raw HTML if the push shape ever changes.
function decodeFlight(html) {
  let flight = '';
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m;
  while ((m = re.exec(html))) {
    try { flight += JSON.parse(m[1]); } catch { /* skip a malformed chunk */ }
  }
  return flight || html.replace(/\\"/g, '"').replace(/\\n/g, '\n');
}

// Bracket-match the "initialEvents":[ ... ] array (string-aware, so a "]" inside a
// description never ends it early). Returns [] if the key/array isn't found.
function extractEvents(flight) {
  const key = '"initialEvents":';
  const at = flight.indexOf(key);
  if (at === -1) return [];
  const open = flight.indexOf('[', at);
  if (open === -1) return [];
  let depth = 0, inStr = false, esc = false;
  for (let k = open; k < flight.length; k++) {
    const c = flight[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) {
      try { return JSON.parse(flight.slice(open, k + 1)); } catch { return []; }
    }
  }
  return [];
}

// "7:00 PM – 8:30 PM" (any dash) / "7:00 PM" / "" on a YYYY-MM-DD day → ET instants.
// No time = an all-day entry (makeRow re-anchors to local noon).
function parseWhen(date, time) {
  const times = [...String(time || '').matchAll(/(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/gi)];
  if (!times.length) return { start: etToDate(`${date} 12:00:00`), end: null, allDay: true };
  const iso = (t) => {
    let h = parseInt(t[1], 10) % 12;
    if (/p/i.test(t[3])) h += 12;
    return `${date} ${String(h).padStart(2, '0')}:${t[2]}:00`;
  };
  return {
    start: etToDate(iso(times[0])),
    end: times[1] ? etToDate(iso(times[1])) : null,
    allDay: false,
  };
}

export async function pull(source, { floor, cutoff }) {
  const url = source.url.replace(/\/+$/, '') + '/';
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const events = extractEvents(decodeFlight(html));
  if (!Array.isArray(events) || !events.length) {
    throw new Error('no initialEvents array (BaseLocal page shape changed)');
  }

  const bleed = BLEED_TOWNS[source.city_id];
  const seen = new Set();
  const out = [];
  for (const e of events) {
    if (!e || seen.has(e.id) || !e.date) continue;
    seen.add(e.id);
    const title = clean(e.name);
    if (!title) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
    // Drop known unserved neighbors this city page bleeds in (see BLEED_TOWNS).
    if (bleed && bleed.test(`${e.venue} ${title}`)) continue;
    const { start, end, allDay } = parseWhen(e.date, e.time);
    if (!start) continue;
    const t = start.getTime();
    if (t < floor || t > cutoff) continue;
    out.push({
      summary: title,
      description: clean(e.longDescription || e.description),
      location: clean(e.venue), // drives makeRow's per-event town routing
      url: /^https?:\/\//.test(e.url || '') ? e.url : null,
      image: null,
      start,
      end,
      allDay,
    });
  }
  return out;
}
