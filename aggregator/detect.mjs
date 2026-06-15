// Probe a venue URL for machine-readable event sources.
//   node detect.mjs https://venue.org https://venue2.org/events ...
// Reports, per URL, whether we can pull events via:
//   - iCal feed (?ical=1 etc.)            -> aggregate type 'ical'
//   - schema.org JSON-LD on the page      -> aggregate type 'jsonld'
//   - The Events Calendar (Tribe) REST    -> use the ?ical=1 variant
//   - Localist API                        -> /api/2/events (json)

import { extractJsonLdEvents } from './jsonld.mjs';

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Accept: 'text/html,text/calendar,application/json,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function get(url) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow' });
    const text = await r.text();
    return { status: r.status, text, ct: (r.headers.get('content-type') || '').split(';')[0] };
  } catch (e) {
    return { status: 0, text: '', ct: '', err: e.message };
  }
}

function icalVariants(u) {
  const url = new URL(u);
  const base = `${url.origin}${url.pathname}`.replace(/\/$/, '');
  return [
    `${base}/?ical=1`,
    `${base}/?post_type=tribe_events&ical=1&eventDisplay=list`,
    `${url.origin}/events/?ical=1`,
    `${url.origin}/?post_type=tribe_events&ical=1&eventDisplay=list`,
    `${base}?format=ical`, // Squarespace events collection
    `${url.origin}/common/modules/iCalendar/iCalendar.aspx?feed=calendar`, // CivicPlus / CivicEngage
  ];
}

async function probe(u) {
  const found = [];
  // 1) iCal
  for (const cand of icalVariants(u)) {
    const r = await get(cand);
    if (r.text.includes('BEGIN:VCALENDAR')) {
      const n = (r.text.match(/BEGIN:VEVENT/g) || []).length;
      found.push({ type: 'ical', url: cand, events: n });
      break;
    }
  }
  // 2) JSON-LD on the page
  const page = await get(u);
  if (page.status === 200) {
    const evs = extractJsonLdEvents(page.text);
    const future = evs.filter((e) => e.start && e.start.getTime() > Date.now() - 86400000);
    if (future.length) found.push({ type: 'jsonld', url: u, events: future.length });
  } else if (page.status) {
    found.push({ type: 'blocked?', url: u, events: `HTTP ${page.status}` });
  }
  // 3) Tribe REST (often present even when ?ical isn't obvious)
  try {
    const o = new URL(u).origin;
    const t = await get(`${o}/wp-json/tribe/events/v1/events?per_page=5`);
    if (t.ct.includes('json') && t.text.includes('"events"')) {
      const n = (t.text.match(/"id":/g) || []).length;
      found.push({ type: 'tribe-rest', url: `${o}/events/?ical=1`, note: `REST present (~${n}); use ?ical=1` });
    }
  } catch {}
  // 4) Localist
  try {
    const o = new URL(u).origin;
    const l = await get(`${o}/api/2/events?days=60`);
    if (l.ct.includes('json') && l.text.includes('"event"')) {
      found.push({ type: 'localist', url: `${o}/api/2/events`, note: 'Localist JSON API' });
    }
  } catch {}
  return found;
}

async function main() {
  const urls = process.argv.slice(2);
  if (!urls.length) {
    console.log('usage: node detect.mjs <url> [url2 ...]');
    process.exit(1);
  }
  for (const u of urls) {
    const f = await probe(u);
    if (!f.length) {
      console.log(`—  ${u}\n     nothing pullable found`);
    } else {
      console.log(`✓  ${u}`);
      f.forEach((x) => console.log(`     [${x.type}] ${x.events != null ? x.events + ' events ' : ''}${x.note || ''} ${x.url}`));
    }
  }
}

main();
