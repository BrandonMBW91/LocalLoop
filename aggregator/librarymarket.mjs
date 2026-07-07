// Pull events from libraries running LibraryMarket's "LC Events" (Drupal) calendar,
// which exposes a free, key-free JSON feed the iCal reader can't use. One connector,
// many libraries — add a {host, city_id} row to LIBS to onboard another.
//
//   node librarymarket.mjs             # pull + write
//   node librarymarket.mjs --dry-run   # print, write nothing
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { cityFromLocation } from './towns.mjs';

loadDotEnv();
const DRY_RUN = process.argv.includes('--dry-run');
const HORIZON_DAYS = 90;

const LIBS = [
  { host: 'https://events.northcantonlibrary.org', city_id: 'north-canton', name: 'North Canton Public Library' },
];

const clean = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);
const first = (o) => (o && typeof o === 'object' ? Object.values(o)[0] : '') || '';

// Convert a library-local wall-clock ("2026-07-01 16:30:00") in a named tz to a
// real UTC ISO instant, DST-correct (Intl knows the tz rules).
function localToISO(local, tz = 'America/New_York') {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(local || '');
  if (!m) return null;
  const [, Y, Mo, D, h, mi] = m.map(Number);
  const asUTC = Date.UTC(Y, Mo - 1, D, h, mi, 0);
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(asUTC));
  const gp = (t) => Number((p.find((x) => x.type === t) || {}).value);
  const tzWall = Date.UTC(gp('year'), gp('month') - 1, gp('day'), gp('hour') % 24, gp('minute'), gp('second'));
  return new Date(asUTC - (tzWall - asUTC)).toISOString();
}

function categorize(title, programType) {
  const t = `${title} ${programType}`.toLowerCase();
  if (/storytime|story time|kids?|children|family|toddler|baby|lego|craft/.test(t)) return 'Family';
  if (/teen|adult|book club|genealogy|lecture|author/.test(t)) return 'Community';
  if (/class|workshop|computer|resume|tech|tutor|coding|learn/.test(t)) return 'Education';
  if (/concert|music|movie|film|art|paint/.test(t)) return 'Arts';
  return 'Family';
}

async function pull(lib) {
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + HORIZON_DAYS * 86400000).toISOString().slice(0, 10);
  const url = `${lib.host}/events/feed/json?_wrapper_format=lc_calendar_feed&start=${start}&end=${end}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (LocalLoop aggregator)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('not a JSON array (feed shape changed)');
  const rows = [];
  for (const e of data) {
    if (e.type !== 'lc_event' || e.public === false) continue;
    const startIso = localToISO(e.start_date, e.timezone);
    const title = clean(e.title);
    if (!title || !startIso) continue;
    const branch = first(e.branch);
    const room = first(e.room);
    const offsite = e.offsite_address || '';
    const isOff = /off ?site/i.test(branch);
    const venue = (isOff && offsite ? offsite.split(/[\n,]/)[0] : (branch || lib.name)).replace(/\s+/g, ' ').trim();
    const address = isOff ? clean(offsite) : '';
    const assigned = cityFromLocation(`${venue} ${address}`, lib.city_id);
    if (!assigned) continue; // out-of-area
    const source_uid = createHash('sha1').update(`${assigned}|${title.toLowerCase()}|${startIso}`).digest('hex').slice(0, 24);
    rows.push({
      city_id: assigned, title, category: categorize(title, first(e.program_type)),
      emoji: '📚', start_at: startIso, end_at: e.end_date ? localToISO(e.end_date, e.timezone) : null,
      venue: venue.slice(0, 200) + (room ? ` (${room})` : ''), address: clean(address),
      price: 'Free', host: lib.name, description: clean(e.description) || `${title} at ${lib.name}.`,
      source_uid, ticket_url: /^https:\/\//.test(e.url || '') ? e.url : null,
    });
  }
  return rows;
}

const all = [];
const seen = new Set();
for (const lib of LIBS) {
  try {
    const rows = (await pull(lib)).filter((r) => (seen.has(r.source_uid) ? false : seen.add(r.source_uid)));
    all.push(...rows);
    console.log(`  ${lib.name}: ${rows.length} events`);
  } catch (e) { console.error(`  ! ${lib.name}: ${e.message}`); }
}

if (DRY_RUN) {
  all.slice(0, 12).forEach((r) => console.log(`    • ${r.start_at.slice(0, 16)} [${r.category}] ${r.title} @ ${r.venue}`));
  console.log(`\n${all.length} events (dry run — nothing written)`);
} else if (all.length) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const uids = all.map((r) => r.source_uid);
  const have = new Set();
  for (let i = 0; i < uids.length; i += 200) {
    const { data } = await sb.from('events').select('source_uid').in('source_uid', uids.slice(i, i + 200));
    (data || []).forEach((r) => have.add(r.source_uid));
  }
  const fresh = all.filter((r) => !have.has(r.source_uid));
  if (!fresh.length) { console.log('\nNo new LibraryMarket events.'); }
  else {
    const { data, error } = await sb.from('events').upsert(fresh, { onConflict: 'source_uid', ignoreDuplicates: true }).select('id');
    if (error) { console.error('write error:', error.message); process.exit(1); }
    console.log(`\nAdded ${data ? data.length : 0} new LibraryMarket event(s).`);
  }
}
