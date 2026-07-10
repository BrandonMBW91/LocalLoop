// Pull each registered food-truck calendar (Google Calendar / any iCal) into the
// food_trucks table, so trucks never post manually — they send one calendar link
// and their stops appear automatically (the Jonny Burritos objection, solved).
//   node truck-calendars.mjs            # ingest + prune past aggregator stops
//   node truck-calendars.mjs --dry-run  # report only
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { loadDotEnv } from './env.mjs';
import { wallParts } from './et.mjs';

// SSRF guard: truck-calendar feeds are submitted by anyone and auto-approved, and this
// script runs with the service role, so a feed URL must never point us at an internal
// address. Validate the scheme + the resolved IP, and follow redirects MANUALLY so a
// public URL can't 302 us onto localhost / cloud metadata / a private range.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    return p[0] === 0 || p[0] === 127 || p[0] === 10
      || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
      || (p[0] === 192 && p[1] === 168) || p[0] >= 224;
  }
  const s = ip.toLowerCase();
  return s === '::1' || s === '::' || s.startsWith('fe80:') || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('::ffff:');
}
async function assertPublicUrl(u) {
  let url;
  try { url = new URL(u); } catch { throw new Error('bad url'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`blocked scheme ${url.protocol}`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new Error('blocked host');
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error('private ip'); return; }
  const { address } = await lookup(host);
  if (isPrivateIp(address)) throw new Error('private ip');
}
async function safeFeedFetch(u, headers) {
  let current = u;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { headers, redirect: 'manual' });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { current = new URL(loc, current).toString(); continue; }
    return res;
  }
  throw new Error('too many redirects');
}

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
    const block = m[1];
    const get = (name) => {
      const r = new RegExp('^' + name + '(;[^:\\n]*)?:(.*)$', 'm').exec(block);
      return r ? { params: r[1] || '', value: r[2].trim() } : null;
    };
    events.push({ summary: get('SUMMARY'), location: get('LOCATION'), dtstart: get('DTSTART'), dtend: get('DTEND'), desc: get('DESCRIPTION'), cls: get('CLASS'), status: get('STATUS') });
  }
  return events;
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

const { data: cals, error: calErr } = await sb.from('truck_calendars').select('*').eq('enabled', true);
if (calErr) { console.error(calErr.message); process.exit(1); }
console.log(`${cals.length} enabled truck calendar(s).`);

let totalStops = 0;
for (const cal of cals) {
  let stops = 0, skipped = 0, error = null;
  try {
    const res = await safeFeedFetch(cal.ical_url, UA);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('not iCal (bot wall or moved feed?)');
    const rows = [];
    for (const ev of parseICS(text)) {
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
    stops = rows.length;
    if (!DRY) {
      if (rows.length) {
        const { error: upErr } = await sb.from('food_trucks').upsert(rows, { onConflict: 'source_uid', ignoreDuplicates: false });
        if (upErr) throw upErr;
      }
      // Reconcile: remove this truck's FUTURE calendar-stops that are no longer in the
      // feed — a stop the owner deleted, or one now filtered out as private/personal —
      // so the public food-truck side always mirrors the current calendar. Only runs on
      // a successful fetch (inside the try), so a temporarily-down feed never wipes stops.
      let del = sb.from('food_trucks').delete()
        .eq('city_id', cal.city_id).eq('name', cal.name)
        .gte('date', todayET).not('source_uid', 'is', null);
      if (rows.length) del = del.not('source_uid', 'in', `(${rows.map((r) => r.source_uid).join(',')})`);
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
