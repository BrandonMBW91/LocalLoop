// Compute per-town outreach priority weights = blend(population, users) and write
// outreach/town-weights.json for the sender + preview to consume. Read-only vs DB.
//   node town-priority.mjs
//   OUTREACH_USER_WEIGHT=1 OUTREACH_POP_WEIGHT=1 node town-priority.mjs  (tune)
//
// weight(town) = Wu * (users / maxUsers) + Wp * (sqrt(pop) / sqrt(maxPop))
//   users : device_activity rows for that city_id (proven local audience)
//   pop   : ~2020 population from cities.js (market potential; sqrt-compressed so
//           mid/small towns aren't crushed to ~0 and still rotate in over time)
// A town with real users outranks an equally-sized town with none — so a big but
// audience-less market (e.g. Youngstown today) sits below Findlay/Toledo but above
// the small towns, on size alone.
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
const Wu = Number(process.env.OUTREACH_USER_WEIGHT || 1);
const Wp = Number(process.env.OUTREACH_POP_WEIGHT || 1);

async function all(path) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${SB}/rest/v1/${path}&limit=1000&offset=${offset}`, { headers: H });
    if (!r.ok) break;
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) break;
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

// "users" = engaged devices per town (device_activity). Falls back to push_tokens
// if device_activity is empty/unavailable.
let act = await all('human_activity?select=city_id');
if (!act.length) act = await all('push_tokens?select=city_id');
const usersById = {};
for (const r of act) { const c = r.city_id || 'findlay'; usersById[c] = (usersById[c] || 0) + 1; }

const maxUsers = Math.max(1, ...Object.values(usersById));
const maxPop = Math.max(1, ...CITIES.map((c) => c.pop || 0));
const sq = (n) => Math.sqrt(Math.max(0, n));

const weights = {};       // by town NAME (businesses.json uses names)
const detail = {};
for (const c of CITIES) {
  const users = usersById[c.id] || 0;
  const userNorm = users / maxUsers;
  const popNorm = sq(c.pop || 0) / sq(maxPop);
  const w = Wu * userNorm + Wp * popNorm;
  weights[c.name] = Number(w.toFixed(4));
  detail[c.name] = { pop: c.pop || 0, users, region: c.region, weight: Number(w.toFixed(4)) };
}

writeFileSync(join(ROOT, 'outreach', 'town-weights.json'), JSON.stringify({
  weights, detail, params: { Wu, Wp, maxUsers, maxPop }, generated_at: new Date().toISOString(),
}, null, 2) + '\n');

console.log(`wrote outreach/town-weights.json  (Wu=${Wu} Wp=${Wp}, maxUsers=${maxUsers})`);
console.log('\ntop 20 towns by priority:');
console.log('town                users   pop     weight');
for (const [name, d] of Object.entries(detail).sort((a, b) => b[1].weight - a[1].weight).slice(0, 20)) {
  console.log((name + ' '.repeat(20)).slice(0, 20) + String(d.users).padStart(4) + String(d.pop).padStart(9) + '   ' + d.weight.toFixed(3));
}
