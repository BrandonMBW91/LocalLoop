// Explore Licking County (explorelc.org) — the CVB for Newark, Granville, Heath,
// Utica, Hebron, Buckeye Lake and the rest of Licking County.
//
// It is a Next.js app that ships its whole event list inside the RSC flight
// stream (same trick as platforms/baselocal.mjs, different payload shape). One
// row feeds the whole county: each event carries its own `eventLocation` slug,
// so events self-route to whichever of those towns we actually carry and the
// rest are dropped by the caller's town matcher.
//
// Event shape in the flight data:
//   { id, eventTitle, eventDate: "July 16 2026", eventLocation: "newark",
//     eventPartner: "Weathervane Playhouse", eventImage: "/images/x.jpg",
//     eventLink: "https://www.facebook.com/events/..." }
//
// Dates are DATE-ONLY (no clock time), so every event is emitted allDay:true and
// the caller anchors it — never invent a time, that was the "12 PM" bug class.
const UA = { 'User-Agent': 'Mozilla/5.0 (LocalLoop aggregator)' };

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Reassemble the RSC flight stream from the page's self.__next_f pushes.
function decodeFlight(html) {
  let flight = '';
  const re = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\]\)/g;
  let m;
  while ((m = re.exec(html))) {
    try { flight += JSON.parse(m[1]); } catch { /* skip a malformed chunk */ }
  }
  return flight || html.replace(/\\"/g, '"').replace(/\\n/g, '\n');
}

// Brace-match every object carrying an "eventTitle". The events sit inside a
// component payload rather than one named array, so anchor on the key itself.
function extractEvents(flight) {
  const out = [];
  let idx = 0;
  while ((idx = flight.indexOf('"eventTitle"', idx)) !== -1) {
    const start = flight.lastIndexOf('{', idx);
    if (start === -1) { idx += 12; continue; }
    let depth = 0, inStr = false, esc = false, done = false;
    for (let k = start; k < flight.length && !done; k++) {
      const ch = flight[k];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try { out.push(JSON.parse(flight.slice(start, k + 1))); } catch { /* skip */ }
          idx = k;
          done = true;
        }
      }
    }
    idx++;
  }
  return out;
}

// "July 16 2026" -> a Date at local midnight. Returns null on anything else, so a
// format change yields zero events (and a visible feed-health error) rather than
// silently mis-dated ones.
function parseDay(s) {
  const m = /^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/.exec(clean(s));
  if (!m) return null;
  const MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
  const mo = MONTHS[m[1].toLowerCase()];
  if (mo === undefined) return null;
  const d = new Date(Number(m[3]), mo, Number(m[2]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function pull(source, { floor, cutoff }) {
  const url = source.url.replace(/\/+$/, '');
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const events = extractEvents(decodeFlight(await res.text()));
  if (!events.length) throw new Error('no eventTitle objects (explorelc page shape changed)');

  const seen = new Set();
  const out = [];
  for (const e of events) {
    if (!e || !e.eventTitle) continue;
    const start = parseDay(e.eventDate);
    if (!start) continue;
    if ((floor && start < floor) || (cutoff && start > cutoff)) continue;
    // The same event repeats per day in the payload; key on id+date so a real
    // multi-day run keeps each day but exact dupes collapse.
    const key = `${e.id || e.eventTitle}|${e.eventDate}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // eventLocation is the town slug; eventPartner is the venue. Hand both to the
    // caller as "Venue, Town" so its matcher routes to the right town and drops
    // Licking County towns we do not carry.
    // Title-case the slug: it lands in the address, and "newark, OH" read as
    // lowercase junk on the cards.
    const town = clean(e.eventLocation).replace(/-/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
    const venue = clean(e.eventPartner);
    const location = [venue, town ? `${town}, OH` : ''].filter(Boolean).join(', ');

    out.push({
      summary: clean(e.eventTitle),
      description: '',
      location,
      url: /^https?:\/\//i.test(e.eventLink || '') ? e.eventLink : url,
      image: e.eventImage && !/^https?:/i.test(e.eventImage) ? `${url.replace(/\/events$/, '')}${e.eventImage}` : (e.eventImage || null),
      start,
      end: null,
      allDay: true, // date-only source: never invent a clock time
    });
  }
  return out;
}
