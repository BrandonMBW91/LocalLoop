// Real upcoming-event stats for outreach copy. Read-only against the DB.
//   node event-stats.mjs
// Prints total upcoming approved events, # of towns that have upcoming events,
// and total supported towns — the numbers the outreach draft claims — and writes
// outreach/stats.json (counts + a town-name -> region map) so assemble-drafts.cjs
// can render accurate, region-aware copy. Refresh flow: run this, then
// `node assemble-drafts.cjs` from outreach/.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CITIES } from '../src/data/cities.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const env = readFileSync(join(ROOT, '.env'), 'utf8') + '\n' + readFileSync(join(ROOT, 'aggregator', '.env'), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const SB = g('EXPO_PUBLIC_SUPABASE_URL') || g('SUPABASE_URL');
const KEY = g('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

const now = new Date().toISOString();
const base = `events?status=eq.approved&start_at=gte.${now}`;

// exact total
const head = await fetch(`${SB}/rest/v1/${base}&select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
const total = Number((head.headers.get('content-range') || '/0').split('/')[1]) || 0;

// distinct towns with upcoming events (page through city_id)
const townCounts = {};
for (let offset = 0; ; offset += 1000) {
  const r = await fetch(`${SB}/rest/v1/${base}&select=city_id&limit=1000&offset=${offset}`, { headers: H });
  const rows = await r.json();
  if (!Array.isArray(rows) || !rows.length) break;
  for (const e of rows) { const c = e.city_id || 'findlay'; townCounts[c] = (townCounts[c] || 0) + 1; }
  if (rows.length < 1000) break;
}
const townsWithEvents = Object.keys(townCounts).length;

// Round the event total DOWN to the nearest 500 so the "more than N" claim is
// always conservatively true even as events roll off.
const eventsFloor = Math.floor(total / 500) * 500;
const regionByTown = Object.fromEntries(CITIES.map((c) => [c.name, c.region]));

const stats = {
  upcoming_events: total,
  upcoming_events_floor: eventsFloor,
  towns_with_events: townsWithEvents,
  total_supported_towns: CITIES.length,
  region_by_town: regionByTown,
  generated_at: new Date().toISOString(),
};
writeFileSync(join(ROOT, 'outreach', 'stats.json'), JSON.stringify(stats, null, 2) + '\n');

console.log('upcoming_approved_events:', total, `(claim floor: ${eventsFloor})`);
console.log('towns_with_events:', townsWithEvents);
console.log('total_supported_towns:', CITIES.length);
console.log('wrote outreach/stats.json');
console.log('\nper-town (top 15):');
for (const [c, n] of Object.entries(townCounts).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${c}: ${n}`);
