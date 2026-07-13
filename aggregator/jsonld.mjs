// Generic schema.org Event extractor. Many modern event pages (WordPress "The
// Events Calendar", Squarespace, Wix, venue sites) embed event data as JSON-LD
// in the HTML — the same structured data search engines read. This pulls those
// out so we can aggregate sites that don't expose an iCal feed.

import { etToDate } from './et.mjs';

// Find every <script type="application/ld+json"> block and collect Event nodes
// (handles arrays, @graph, and nested types). Returns objects shaped like the
// iCal events makeRow() already understands: { summary, start, end, location, description }.
export function extractJsonLdEvents(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let json;
    try {
      json = JSON.parse(m[1].trim());
    } catch {
      continue; // malformed block — skip
    }
    collect(json, out);
  }
  // De-dupe within the page by title+start (some themes emit an event twice).
  const seen = new Set();
  return out.filter((e) => {
    const k = `${e.summary}|${e.start && e.start.toISOString()}`;
    return seen.has(k) ? false : seen.add(k);
  });
}

function collect(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out));
    return;
  }
  const t = node['@type'];
  const types = Array.isArray(t) ? t : [t];
  if (types.some((x) => /(^|[^a-z])Event$/i.test(String(x || '')))) {
    const ev = normalize(node);
    if (ev) out.push(ev);
    return; // don't dig into an event's own sub-objects
  }
  // Generic descent: find Events wherever they're nested — @graph, ItemList's
  // itemListElement → item (Eventbrite), etc.
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') collect(v, out);
  }
}

function locString(loc) {
  if (!loc) return '';
  if (typeof loc === 'string') return loc;
  if (Array.isArray(loc)) return locString(loc[0]);
  const name = typeof loc.name === 'string' ? loc.name : '';
  const a = loc.address;
  let addr = '';
  if (typeof a === 'string') addr = a;
  else if (a && typeof a === 'object') {
    addr = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
      .filter(Boolean).join(', ');
  }
  if (!addr) return name;
  if (!name) return addr;
  // Avoid duplication when the name already contains the address (or vice versa).
  const nl = name.toLowerCase(), al = addr.toLowerCase();
  if (nl.includes(al)) return name;
  if (al.includes(nl)) return addr;
  return `${name}, ${addr}`;
}

function cleanDesc(d) {
  if (typeof d !== 'string') return '';
  return d.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function imageUrl(img) {
  if (!img) return '';
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return imageUrl(img[0]);
  if (typeof img === 'object') return typeof img.url === 'string' ? img.url : '';
  return '';
}

// Parse a schema.org date, SERVER-TIMEZONE-INDEPENDENTLY (the old local-midnight
// mint put date-only events a day early on the UTC CI runner):
// - date-only ("2026-08-08") -> noon EASTERN of that calendar day (allDay stays
//   true downstream, and aggregate's etNoon anchor is idempotent on noon ET);
// - offset-less datetimes ("2026-08-08T19:00:00") are venue-local Eastern wall
//   times -> DST-correct ET conversion (new Date(raw) read them as server-local);
// - explicit Z/offset datetimes parse as-is.
function parseDate(raw) {
  const s = String(raw || '');
  if (/^(\d{4})-(\d{2})-(\d{2})$/.test(s)) return etToDate(`${s}T12:00`);
  if (/T\d{2}:\d{2}/.test(s) && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) return etToDate(s) || new Date(s);
  return new Date(s);
}

function normalize(node) {
  const name = typeof node.name === 'string' ? node.name
    : Array.isArray(node.name) ? node.name[0] : '';
  const startRaw = node.startDate;
  if (!name || !startRaw) return null;
  const start = parseDate(startRaw);
  if (isNaN(start)) return null;
  let end = node.endDate ? parseDate(node.endDate) : null;
  // Midnight rollover: Eventbrite JSON-LD emits an end clock-time without rolling
  // the date, so a 9pm-1am event parses as end BEFORE start. Push end to the next
  // day (the Jul 2026 audit found 366 backwards-time rows, all from this source).
  if (end && !isNaN(end) && end < start) {
    const rolled = new Date(end.getTime() + 24 * 3600 * 1000);
    end = rolled - start < 24 * 3600 * 1000 ? rolled : null;
  }
  const image = imageUrl(node.image);
  return {
    summary: String(name),
    start,
    end: end && !isNaN(end) ? end : null,
    location: locString(node.location),
    description: cleanDesc(node.description),
    url: typeof node.url === 'string' ? node.url : '',
    image: /^https?:\/\//.test(image) ? image : '',
    allDay: /^\d{4}-\d{2}-\d{2}$/.test(String(startRaw)), // date-only = all-day
  };
}
