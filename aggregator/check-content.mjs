// Content guard — every town in the picker must actually have upcoming events.
// Enforces the "never ship a ghost town" rule automatically (was a manual DB query).
//
//   node check-content.mjs                       # report per-town counts, flag ghosts/thin
//   node check-content.mjs --strict              # exit 1 if ANY picker town has 0 events
//   node check-content.mjs --strict --allow=larue,prospect,green-camp
//                                                 # exit 1 only on an UNexpected ghost
//
// Wire --strict (+ --allow for known-legacy empties) into run-all.mjs / CI / a pre-OTA
// step so a NEWLY added empty town can never ship.
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { CITIES } from '../src/data/cities.js';

loadDotEnv();
const STRICT = process.argv.includes('--strict');
const THIN = Number(process.env.THIN || 5);

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Tally upcoming events per city_id (paginate past PostgREST's 1000-row cap).
const nowIso = new Date().toISOString();
const counts = {};
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb
    .from('events')
    .select('city_id')
    .gte('start_at', nowIso)
    .range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  for (const r of data || []) counts[r.city_id] = (counts[r.city_id] || 0) + 1;
  if (!data || data.length < 1000) break;
}

const rows = CITIES
  .map((c) => ({ id: c.id, name: c.name, region: c.region, n: counts[c.id] || 0 }))
  .sort((a, b) => a.n - b.n);
const total = Object.values(counts).reduce((a, b) => a + b, 0);
const ghosts = rows.filter((r) => r.n === 0);
const thin = rows.filter((r) => r.n > 0 && r.n < THIN);

console.log(`Content check — ${CITIES.length} picker towns · ${total} upcoming events\n`);
console.log('Thinnest 15 towns:');
rows.slice(0, 15).forEach((r) => console.log(`  ${String(r.n).padStart(4)}  ${r.name} (${r.region})`));

// Events tagged to a city_id that is NOT in the picker (held/removed towns, mis-routes).
const pickerIds = new Set(CITIES.map((c) => c.id));
const orphans = Object.entries(counts).filter(([id]) => !pickerIds.has(id));
if (orphans.length) {
  console.log(`\nnote: upcoming events for NON-picker city_ids (orphans): ${orphans.map(([id, n]) => `${id}:${n}`).join(', ')}`);
}

if (ghosts.length) console.log(`\n⚠ GHOST TOWNS (0 events, still in picker): ${ghosts.map((r) => r.name).join(', ')}`);
else console.log('\n✔ no ghost towns — every picker town has upcoming events.');
if (thin.length) console.log(`… thin (<${THIN}): ${thin.map((r) => `${r.name}:${r.n}`).join(', ')}`);

if (STRICT && ghosts.length) {
  console.error(`\nstrict: ${ghosts.length} ghost town(s) in the picker → failing.`);
  process.exit(1);
}
