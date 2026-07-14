// Pull each registered food-truck calendar (Google Calendar / any iCal) into the
// food_trucks table, so trucks never post manually — they send one calendar link
// and their stops appear automatically (the Jonny Burritos objection, solved).
//   node truck-calendars.mjs            # ingest + prune past aggregator stops
//   node truck-calendars.mjs --dry-run  # report only
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { loadDotEnv } from './env.mjs';
import { wallParts } from './et.mjs';
import { safeFetch } from './safe-fetch.mjs';

// SSRF-safe fetch (scheme/host/resolved-IP checks + socket-level DNS pin + manual
// redirects) lives in ./safe-fetch.mjs, shared with the event aggregator — truck
// feeds are user-submitted and this runs with the service role.

loadDotEnv();
const DRY = process.argv.includes('--dry-run');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const UA = { 'User-Agent': 'Mozilla/5.0 (LocalLoop truck-calendars)' };
const sha1 = (s) => createHash('sha1').update(s).digest('hex');

// --- minimal iCal parser: unfold, then split VEVENTs ---
// A stop the owner clearly doesn't want on their public list. The reliable signal is
// the calendar's own Private flag (CLASS:PRIVATE / CONFIDENTIAL) or a Cancelled status;
// this title keyword list is a backstop for owners who forget to set that. Kept
// conservative to avoid dropping legit public stops (e.g. "Holiday Market" is fine).
const PERSONAL_RE = /\b(private|personal|appointment|appt\.?|dentist|doctor|dr\.|vacation|day ?off|out of (office|town)|not available|unavailable|do not book|blocked|birthday|anniversary|family (time|dinner|event|gathering|party)|closed)\b/i;

function parseICS(text) {
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const events = [];
  const re = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let m;
  while ((m = re.exec(unfolded))) {
    // Strip embedded VALARM sub-components first: their DESCRIPTION ("This is
    // an event reminder") would otherwise be read as the stop's public note.
    const block = m[1].replace(/BEGIN:VALARM[\s\S]*?END:VALARM/g, '');
    const get = (name) => {
      const r = new RegExp('^' + name + '(;[^:\\n]*)?:(.*)$', 'm').exec(block);
      return r ? { params: r[1] || '', value: unescapeText(r[2].trim()) } : null;
    };
    events.push({ summary: get('SUMMARY'), location: get('LOCATION'), dtstart: get('DTSTART'), dtend: get('DTEND'), desc: get('DESCRIPTION'), cls: get('CLASS'), status: get('STATUS'), rrule: get('RRULE') });
  }
  return events;
}

// RFC 5545 TEXT values escape , ; \n and backslash — without unescaping, nearly
// every address with a comma published with literal backslashes. Order matters:
// unescape the double-backslash LAST so it can't create new escape sequences.
function unescapeText(s) {
  return String(s || '')
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// Convert a wall-clock in a named IANA zone to the equivalent UTC instant, using
// Node's full tz database (server-side Intl is fine — the Hermes ban is on-device
// only). Corrects the naive "treat wall as UTC" guess by the zone's real offset.
function wallInZoneToUTC(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date(guess)).map((p) => [p.type, p.value])
  );
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  return new Date(guess - (asUTC - guess));
}

// DTSTART/DTEND -> ET wall date + display time. Handles Z (UTC), a named TZID
// (e.g. a truck whose Google Calendar is set to America/Chicago), floating times
// (treated as local ET), and date-only (all-day, no time).
function whenET(field) {
  if (!field) return null;
  const v = field.value;
  const dOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dOnly) return { date: `${dOnly[1]}-${dOnly[2]}-${dOnly[3]}`, time: null };
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!dt) return null;
  let [, y, mo, d, h, mi, , z] = dt;
  const tzid = (String(field.params || '').match(/TZID=([^;:]+)/) || [])[1];
  let instant = null;
  if (z) instant = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, 0)); // UTC
  else if (tzid && tzid !== 'America/New_York') {
    // Named non-Eastern zone -> convert its wall clock to a UTC instant first.
    try { instant = wallInZoneToUTC(+y, +mo, +d, +h, +mi, tzid); } catch { instant = null; }
  }
  if (instant) {
    const p = wallParts(instant); // -> ET wall clock
    y = String(p.y); mo = String(p.mo).padStart(2, '0'); d = String(p.d).padStart(2, '0');
    h = String(p.h).padStart(2, '0'); mi = String(p.mi).padStart(2, '0');
  }
  const hr = +h, m12 = ((hr + 11) % 12) + 1, ap = hr < 12 ? 'AM' : 'PM';
  return { date: `${y}-${mo}-${d}`, time: `${m12}:${mi} ${ap}` };
}

const todayET = (() => { const p = wallParts(new Date()); return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; })();

// StreetFoodFinder profile pages (streetfoodfinder.com/<slug>) have no public
// iCal — the .ics endpoints sit behind a bot wall (HTTP 403) while the page
// itself serves fine. The page's own calendar loads via a form-POST to
// /api/v3/vendor/fetch/calendar with a vtok embedded in the page, returning an
// HTML fragment. Fetch page -> extract vtok -> POST -> parse the fragment.
// Cloudflare 403s Node's TLS fingerprint outright (any UA) while curl passes,
// so these two requests shell out to curl. The URL is an admin-approved
// truck_calendars row, not raw user input.
function curlText(args) {
  return new Promise((resolve, reject) => {
    execFile('curl', ['-sL', '--max-time', '25', ...args], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(new Error(`curl: ${err.message.split(String.fromCharCode(10))[0]}`));
      else resolve(stdout);
    });
  });
}

async function fetchSffStops(cal) {
  const html = await curlText(['-A', 'Mozilla/5.0 (LocalLoop aggregator)', '-H', 'Accept: text/html,application/xhtml+xml', cal.ical_url]);
  const vm = /vtok['"]?\s*[:=]\s*['"]([^'"]+)['"]/.exec(html);
  if (!vm) throw new Error('no vtok on page (SFF layout changed?)');
  const body = await curlText([
    '-A', 'Mozilla/5.0 (LocalLoop aggregator)', '-H', 'Accept: application/json', '-H', `Referer: ${cal.ical_url}`,
    '--data-urlencode', `vtok=${vm[1]}`,
    'https://streetfoodfinder.com/api/v3/vendor/fetch/calendar',
  ]);
  let j;
  try { j = JSON.parse(body); } catch { throw new Error('calendar API returned non-JSON (bot wall?)'); }
  const frag = j?.data?.jax?.['vendor-calendar'] || '';
  if (!frag) throw new Error('no calendar fragment (SFF response changed?)');
  const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
  const nowP = wallParts(new Date());
  const rows = [];
  const stopRe = /lt="([-0-9.]+)" ln="([-0-9.]+)" ad="([^"]*)" tx="([^"]*)"[\s\S]*?txt-mdl txt-sb">\s*([^<]+)[\s\S]*?<small class="txt-gray[^"]*">([^<]+)<\/small>/g;
  let m;
  while ((m = stopRe.exec(frag))) {
    const [, , , adEnc, tx, nameRaw, timeRaw] = m;
    const dm = /([A-Za-z]+)\s+(\d{1,2})/.exec(String(tx).split('-').pop() || '');
    if (!dm) continue;
    const mo = MONTHS[dm[1].toLowerCase()];
    if (!mo) continue;
    // Year inference: SFF prints no year; a month far behind today's is next year.
    let y = nowP.y;
    if (mo < nowP.mo - 1) y += 1;
    const date = `${y}-${String(mo).padStart(2, '0')}-${String(+dm[2]).padStart(2, '0')}`;
    if (date < todayET) continue;
    const times = String(timeRaw).split(/\s+to\s+/i).map((t) => t.trim());
    const loc = nameRaw.trim().slice(0, 200) || cal.name;
    let address = '';
    try { address = decodeURIComponent(adEnc).slice(0, 300); } catch { address = ''; }
    rows.push({
      city_id: cal.city_id, name: cal.name, cuisine: cal.cuisine,
      date, start_time: times[0] || null, end_time: times[1] || null,
      location_name: loc, address: address || null,
      host: cal.host || cal.name, note: null,
      featured: false, status: 'approved',
      source_uid: sha1(`${cal.id}|${date}|${loc}`),
    });
  }
  return rows;
}

const { data: cals, error: calErr } = await sb.from('truck_calendars').select('*').eq('enabled', true);
if (calErr) { console.error(calErr.message); process.exit(1); }
console.log(`${cals.length} enabled truck calendar(s).`);

let totalStops = 0;
for (const cal of cals) {
  let stops = 0, skipped = 0, error = null;
  try {
    let rows = [];
    let rruleCount = 0;
    if (/streetfoodfinder\.com/i.test(cal.ical_url)) {
      rows = await fetchSffStops(cal);
    } else {
    const res = await safeFetch(cal.ical_url, UA);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('not iCal (bot wall or moved feed?)');
    for (const ev of parseICS(text)) {
      // RRULE recurring stops are NOT expanded by this minimal parser — only the
      // master DTSTART ingests, and once that's past the series silently yields
      // nothing. Surface it on the calendar record instead of a silent no-op.
      if (ev.rrule) rruleCount++;
      const start = whenET(ev.dtstart);
      if (!start || start.date < todayET) continue; // future stops only
      // Privacy: never publish an event the owner marked Private/Confidential or
      // Cancelled in their calendar, or whose title reads as a personal appointment.
      const vis = (ev.cls?.value || '').toUpperCase();
      if (vis === 'PRIVATE' || vis === 'CONFIDENTIAL') { skipped++; continue; }
      if ((ev.status?.value || '').toUpperCase() === 'CANCELLED') { skipped++; continue; }
      if (PERSONAL_RE.test(ev.summary?.value || '')) { skipped++; continue; }
      const loc = (ev.summary?.value || ev.location?.value || cal.name).slice(0, 200);
      const end = whenET(ev.dtend);
      rows.push({
        city_id: cal.city_id, name: cal.name, cuisine: cal.cuisine,
        date: start.date, start_time: start.time, end_time: end?.time || null,
        location_name: loc, address: ev.location?.value?.slice(0, 300) || null,
        host: cal.host || cal.name, note: (ev.desc?.value || '').slice(0, 500) || null,
        featured: false, status: 'approved',
        source_uid: sha1(`${cal.id}|${start.date}|${loc}`),
      });
    }
    }
    // De-dup the payload by source_uid: two same-day events with the same
    // summary/location hash identically, and Postgres aborts the ENTIRE upsert
    // with "ON CONFLICT DO UPDATE command cannot affect row a second time".
    const seenUid = new Set();
    const uniqueRows = rows.filter((r) => (seenUid.has(r.source_uid) ? false : seenUid.add(r.source_uid)));
    stops = uniqueRows.length;
    if (rruleCount && !error) error = `${rruleCount} recurring event(s) not expanded (RRULE unsupported; post stops individually or flatten the series)`;
    if (!DRY) {
      if (uniqueRows.length) {
        const { error: upErr } = await sb.from('food_trucks').upsert(uniqueRows, { onConflict: 'source_uid', ignoreDuplicates: false });
        if (upErr) throw upErr;
      }
      // Reconcile: remove this truck's FUTURE calendar-stops that are no longer in the
      // feed — a stop the owner deleted, or one now filtered out as private/personal —
      // so the public food-truck side always mirrors the current calendar. Only runs on
      // a successful fetch (inside the try), so a temporarily-down feed never wipes stops.
      let del = sb.from('food_trucks').delete()
        .eq('city_id', cal.city_id).eq('name', cal.name)
        .gte('date', todayET).not('source_uid', 'is', null);
      if (uniqueRows.length) del = del.not('source_uid', 'in', `(${uniqueRows.map((r) => r.source_uid).join(',')})`);
      const { error: delErr } = await del;
      if (delErr) throw delErr;
    }
    console.log(`  ${cal.name} (${cal.city_id}): ${stops} upcoming stop(s)${skipped ? `, ${skipped} private/personal skipped` : ''}${DRY ? ' [dry]' : ''}`);
  } catch (e) {
    error = e.message;
    console.log(`  ! ${cal.name}: ${error}`);
  }
  totalStops += stops;
  if (!DRY) {
    await sb.from('truck_calendars').update({
      last_pulled_at: new Date().toISOString(),
      last_ok_at: error ? cal.last_ok_at : new Date().toISOString(),
      last_stop_count: stops, last_error: error,
    }).eq('id', cal.id);
  }
}

// Retention: drop aggregator-ingested stops now in the past (keep user submissions).
if (!DRY) {
  const { count } = await sb.from('food_trucks').delete({ count: 'exact' })
    .lt('date', todayET).not('source_uid', 'is', null);
  console.log(`Pruned ${count || 0} past aggregator stop(s).`);
}
console.log(`Done. ${totalStops} upcoming truck stop(s) across ${cals.length} calendar(s).`);
