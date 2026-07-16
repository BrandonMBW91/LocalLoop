// Turn a raw iCal location into a consistent { venue, address } pair so the same
// place always shows the same way. The problem: some feeds put a friendly name
// in the location ("Toledo Museum of Art"), some put a bare street address
// ("206 Broadway Findlay OH 45840"), and some leave it blank — which made one
// library show up as both its name AND its street address.

function clean(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Collapse comma-segments a feed repeats inside one location string —
// "…, Columbus, OH 43215, Columbus, 43215" → "…, Columbus, OH 43215". Only an
// EXACT repeated segment, or a bare ZIP already carried by an earlier segment
// ("43215" after "OH 43215"), is dropped — never a mere substring, so "Athens"
// the city survives after "Athens Community Center" the venue.
function dropRepeatedSegments(loc) {
  const seen = [];
  const keep = [];
  for (const part of loc.split(',')) {
    const seg = part.trim();
    if (!seg) continue;
    const norm = seg.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (!norm) continue;
    const zipDupe = /^\d{5}$/.test(norm) && seen.some((s) => s.endsWith(` ${norm}`));
    if (seen.includes(norm) || zipDupe) continue;
    seen.push(norm);
    keep.push(seg);
  }
  return keep.join(', ');
}

// Join address parts, skipping any part already present (token-wise) in what's
// been built. Ticketmaster/SeatGeek/Simpleview feeds often pack city/state/zip
// into line1 too, and blind joins minted "…, Columbus, OH 43202, Columbus, OH,
// 43202" style doubles.
export function joinAddressParts(parts) {
  const norm = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  let out = '';
  for (const raw of parts) {
    const part = clean(String(raw || ''));
    if (!part) continue;
    // Containment only counts once the built string is address-like (has a
    // digit). "Bowling Green State University" containing the city "Bowling
    // Green" must NOT swallow it — but "2619 N. High St., Columbus, OH 43202"
    // already carrying "Columbus"/"OH"/"43202" must.
    if (out && /\d/.test(out) && norm(out).includes(norm(part))) continue;
    out = out ? `${out}, ${part}` : part;
  }
  return out;
}

// Ticketing feeds append SEO junk to titles: their own city ('The Lion King -
// Cleveland' shown to Cleveland users), '<City>, OH 2026' tails, and ALL-CAPS
// shouting. Normalize at ingestion so every surface shows a clean title.
export function cleanEventTitle(title, cityId) {
  let t = String(title || '').trim();
  const city = String(cityId || '').replace(/-/g, ' ').trim();
  if (city) {
    const esc = city.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
    t = t.replace(new RegExp('\\s*[-|]\\s*' + esc + '(?:\\s*,?\\s*(?:OH|Ohio))?(?:\\s*\\d{4})?\\s*$', 'i'), '');
  }
  t = t.replace(/\s*[-|]\s*[A-Z][A-Za-z .']+,?\s*(?:OH|Ohio)\s*(?:\d{4})?\s*$/, '').trim();
  // De-shout: an all-caps title over 12 letters becomes title case.
  if (t.length > 12 && t === t.toUpperCase() && /[A-Z]{4}/.test(t)) {
    t = t.toLowerCase().replace(/(^|[\s(\/&-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }
  return t.trim();
}

export function deriveVenue(rawLocation, sourceName) {
  const loc = dropRepeatedSegments(clean(rawLocation).slice(0, 200));
  const src = clean(sourceName);

  // No location given → the source org IS the venue.
  if (!loc) return { venue: src, address: '' };

  // Starts with a street number → it's a bare street address (e.g.
  // "206 Broadway Findlay OH…"), so show the org name as the venue and keep the
  // street as the address. This is what made one library show up two ways.
  if (/^\d/.test(loc)) return { venue: src || loc, address: loc };

  // Leads with a place name. If a street address follows ("Sunny Street Cafe,
  // 277 W. Nationwide Blvd., Columbus…"), split there so venue and address each
  // hold their own part. The split only fires on a comma followed by a street
  // number, so "Physical Sciences Building, Room 112" stays whole as the venue.
  const m = /^(.*?),\s*(\d+\s.+)$/.exec(loc);
  if (m && !/^\d+\s*(st|nd|rd|th)\b/i.test(m[2])) {
    return { venue: m[1].trim(), address: m[2].trim() };
  }

  // Place name followed only by its TOWN and state, with no street address:
  // "Weathervane Playhouse, Newark, OH". Split the town off so the venue stays
  // the venue. Runs AFTER the street-number rule, so a real address still wins,
  // and requires the 2-letter state (or "Ohio") plus an optional ZIP so a venue
  // whose own name contains a comma ("Main Library - Room A, Garage Level") is
  // never split.
  const t = /^(.*?),\s*([A-Za-z][A-Za-z .'-]{1,28},\s*(?:OH|Ohio)(?:[ ,]+\d{5})?)\s*$/i.exec(loc);
  if (t) return { venue: t[1].trim(), address: t[2].trim() };

  // Pure place name ("Toledo Museum of Art") — venue only, NEVER duplicated
  // into the address (that rendered the same string twice on detail screens).
  return { venue: loc, address: '' };
}
