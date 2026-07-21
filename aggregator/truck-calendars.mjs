// Pull each registered food-truck calendar (Google Calendar / any iCal) into the
// food_trucks table, so trucks never post manually — they send one calendar link
// and their stops appear automatically (the Jonny Burritos objection, solved).
//   node truck-calendars.mjs            # ingest + prune past aggregator stops
//   node truck-calendars.mjs --dry-run  # report only
import './tz-utc.mjs'; // MUST be first: pins TZ=UTC before node-ical/rrule load (see file)
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import ical from 'node-ical';
import { loadDotEnv } from './env.mjs';
import { wallParts } from './et.mjs';
import { safeFetch } from './safe-fetch.mjs';

// How far ahead to expand a recurring series. Matches aggregate.mjs's horizon so a
// truck's weekly stop and a venue's weekly event show the same distance out.
const HORIZON_DAYS = 90;

// SSRF-safe fetch (scheme/host/resolved-IP checks + socket-level DNS pin + manual
// redirects) lives in ./safe-fetch.mjs, shared with the event aggregator — truck
// feeds are user-submitted and this runs with the service role.

loadDotEnv();
const DRY = process.argv.includes('--dry-run');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const UA = { 'User-Agent': 'Mozilla/5.0 (LocalLoop truck-calendars)' };
const sha1 = (s) => createHash('sha1').update(s).digest('hex');

// --- privacy screen (parsing itself is node-ical, see the pull loop) ---
// A stop the owner clearly doesn't want on their public list. The reliable signal is
// the calendar's own Private flag (CLASS:PRIVATE / CONFIDENTIAL) or a Cancelled status;
// this title keyword list is a backstop for owners who forget to set that. Kept
// conservative to avoid dropping legit public stops (e.g. "Holiday Market" is fine).
const PERSONAL_RE = /\b(private|personal|appointment|appt\.?|dentist|doctor|dr\.|vacation|day ?off|out of (office|town)|not available|unavailable|do not book|blocked|birthday|anniversary|family (time|dinner|event|gathering|party)|closed)\b/i;

const todayET = (() => { const p = wallParts(new Date()); return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; })();

// node-ical returns fields that carry iCal params (SUMMARY;LANGUAGE=en-US:…) as
// {params, val} objects. Stringifying those published literal "[object Object]".
const txt = (v) => String(v && typeof v === 'object' && 'val' in v ? v.val : (v ?? '')).trim();

// A node-ical Date -> the ET wall date + display time the row stores.
function etOf(d, allDay) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  if (allDay) {
    // Date-only values are a CALENDAR DAY, not an instant, and node-ical hands them
    // back as UTC midnight. Reading that in Eastern rolls it back to 8pm the previous
    // evening — an all-day Saturday stop would publish as Friday. The UTC components
    // are the day the owner actually picked, so use them verbatim.
    return {
      date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
      time: null,
    };
  }
  const p = wallParts(d);
  const m12 = ((p.h + 11) % 12) + 1, ap = p.h < 12 ? 'AM' : 'PM';
  return {
    date: `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`,
    time: `${m12}:${String(p.mi).padStart(2, '0')} ${ap}`,
  };
}

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
    if (/streetfoodfinder\.com/i.test(cal.ical_url)) {
      rows = await fetchSffStops(cal);
    } else {
    const res = await safeFetch(cal.ical_url, UA);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('not iCal (bot wall or moved feed?)');
    // Parsed with node-ical (NOT the old hand-rolled regex parser) specifically so
    // RRULE series expand. A truck's schedule is mostly recurring — "Earnest Brew
    // Works every Tuesday" is entered ONCE with an RRULE — and the old parser read
    // only the master DTSTART, so a weekly stop showed up once and then vanished
    // for good once that first date passed. Rusty's Road Trip reported it (2026-07-21):
    // 6 one-off stops ingested while his calendar held a full recurring season.
    // node-ical also gives us EXDATE (a cancelled week) and RECURRENCE-ID overrides
    // (a moved week), which the regex parser could not see at all.
    const parsed = await ical.async.parseICS(text);
    const horizonEnd = new Date(Date.now() + HORIZON_DAYS * 86400000);
    for (const ev of Object.values(parsed)) {
      if (!ev || ev.type !== 'VEVENT' || !ev.start) continue;
      // Privacy: never publish an event the owner marked Private/Confidential or
      // Cancelled in their calendar, or whose title reads as a personal appointment.
      const vis = String(ev.class || '').toUpperCase();
      if (vis === 'PRIVATE' || vis === 'CONFIDENTIAL') { skipped++; continue; }
      if (String(ev.status || '').toUpperCase() === 'CANCELLED') { skipped++; continue; }
      const summary = txt(ev.summary), location = txt(ev.location), note = txt(ev.description);
      if (PERSONAL_RE.test(summary)) { skipped++; continue; }

      const allDay = ev.datetype === 'date';
      const durMs = ev.end && ev.start ? Math.max(0, ev.end.getTime() - ev.start.getTime()) : 0;

      // A moved instance lives in ev.recurrences keyed by its ORIGINAL date, so the
      // master expansion must skip that date and publish the moved one separately.
      const overrides = ev.recurrences ? Object.values(ev.recurrences) : [];
      const overriddenDays = new Set(Object.keys(ev.recurrences || {}).map((k) => String(k).slice(0, 10)));
      // EXDATE = a week the owner deleted. Publishing it would send someone to a
      // truck that isn't coming, which is worse than missing the stop entirely.
      const exDays = new Set(Object.keys(ev.exdate || {}).map((k) => String(k).slice(0, 10)));

      let starts = [];
      if (ev.rrule) {
        try { starts = ev.rrule.between(new Date(Date.now() - 86400000), horizonEnd, true); }
        catch { starts = []; }
      } else {
        starts = [ev.start];
      }

      const emit = (whenDate, sum, loc0, addr, noteText) => {
        const start = etOf(whenDate, allDay);
        if (!start || start.date < todayET) return; // future stops only
        const end = durMs ? etOf(new Date(whenDate.getTime() + durMs), allDay) : null;
        const loc = (sum || loc0 || cal.name).slice(0, 200);
        rows.push({
          city_id: cal.city_id, name: cal.name, cuisine: cal.cuisine,
          date: start.date, start_time: start.time, end_time: end?.time || null,
          location_name: loc, address: addr ? addr.slice(0, 300) : null,
          host: cal.host || cal.name, note: noteText ? noteText.slice(0, 500) : null,
          featured: false, status: 'approved',
          source_uid: sha1(`${cal.id}|${start.date}|${loc}`),
        });
      };

      for (const when of starts) {
        const dayKey = etOf(when, allDay)?.date;
        if (!dayKey || exDays.has(dayKey) || overriddenDays.has(dayKey)) continue;
        emit(when, summary, location, location, note);
      }
      // Publish the moved instances at their NEW time (unless themselves cancelled).
      for (const o of overrides) {
        if (!o?.start) continue;
        if (String(o.status || '').toUpperCase() === 'CANCELLED') { skipped++; continue; }
        const oSum = txt(o.summary) || summary;
        if (PERSONAL_RE.test(oSum)) { skipped++; continue; }
        emit(o.start, oSum, txt(o.location) || location, txt(o.location) || location, txt(o.description) || note);
      }
    }
    }
    // De-dup the payload by source_uid: two same-day events with the same
    // summary/location hash identically, and Postgres aborts the ENTIRE upsert
    // with "ON CONFLICT DO UPDATE command cannot affect row a second time".
    const seenUid = new Set();
    const uniqueRows = rows.filter((r) => (seenUid.has(r.source_uid) ? false : seenUid.add(r.source_uid)));
    stops = uniqueRows.length;
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
