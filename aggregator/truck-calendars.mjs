// Pull each registered food-truck calendar (Google Calendar / any iCal) into the
// food_trucks table, so trucks never post manually — they send one calendar link
// and their stops appear automatically (the Jonny Burritos objection, solved).
//   node truck-calendars.mjs            # ingest + prune past aggregator stops
//   node truck-calendars.mjs --dry-run  # report only
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { loadDotEnv } from './env.mjs';
import { wallParts } from './et.mjs';

loadDotEnv();
const DRY = process.argv.includes('--dry-run');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const UA = { 'User-Agent': 'Mozilla/5.0 (LocalLoop truck-calendars)' };
const sha1 = (s) => createHash('sha1').update(s).digest('hex');

// --- minimal iCal parser: unfold, then split VEVENTs ---
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
    events.push({ summary: get('SUMMARY'), location: get('LOCATION'), dtstart: get('DTSTART'), dtend: get('DTEND'), desc: get('DESCRIPTION') });
  }
  return events;
}

// DTSTART/DTEND -> ET wall date + display time. Handles Z (UTC), TZID/floating
// (treated as local ET), and date-only (all-day, no time).
function whenET(field) {
  if (!field) return null;
  const v = field.value;
  const dOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dOnly) return { date: `${dOnly[1]}-${dOnly[2]}-${dOnly[3]}`, time: null };
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!dt) return null;
  let [, y, mo, d, h, mi, , z] = dt;
  if (z) {
    // UTC -> ET wall clock
    const p = wallParts(new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, 0)));
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
  let stops = 0, error = null;
  try {
    const res = await fetch(cal.ical_url, { headers: UA, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('not iCal (bot wall or moved feed?)');
    const rows = [];
    for (const ev of parseICS(text)) {
      const start = whenET(ev.dtstart);
      if (!start || start.date < todayET) continue; // future stops only
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
    if (!DRY && rows.length) {
      const { error: upErr } = await sb.from('food_trucks').upsert(rows, { onConflict: 'source_uid', ignoreDuplicates: false });
      if (upErr) throw upErr;
    }
    console.log(`  ${cal.name} (${cal.city_id}): ${stops} upcoming stop(s)${DRY ? ' [dry]' : ''}`);
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
