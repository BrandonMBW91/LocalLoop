// Read-only: per-town user/device counts from Supabase, for the outreach matrix.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CITIES } from '../src/data/cities.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const env = readFileSync(join(ROOT, '.env'), 'utf8') + '\n' + readFileSync(join(ROOT, 'aggregator', '.env'), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const SB = g('EXPO_PUBLIC_SUPABASE_URL') || g('SUPABASE_URL');
const KEY = g('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

async function all(path) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${SB}/rest/v1/${path}&limit=1000&offset=${offset}`, { headers: H });
    if (!r.ok) { console.error(path, r.status, await r.text()); break; }
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) break;
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

const push = await all('push_tokens?select=city_id');
const act = await all('device_activity?select=city_id').catch(() => []);

const nameById = Object.fromEntries(CITIES.map((c) => [c.id, c.name]));
function tally(rows) {
  const m = {};
  for (const r of rows) { const c = r.city_id || 'findlay'; m[c] = (m[c] || 0) + 1; }
  return m;
}
const pushByTown = tally(push);
const actByTown = tally(act);

console.log('push_tokens total:', push.length, '| device_activity total:', act.length);
console.log('\ncity_id             push  activity  name');
const ids = [...new Set([...Object.keys(pushByTown), ...Object.keys(actByTown)])].sort((a, b) => (pushByTown[b] || 0) - (pushByTown[a] || 0));
for (const id of ids) {
  console.log((id + ' '.repeat(20)).slice(0, 20) + String(pushByTown[id] || 0).padStart(4) + String(actByTown[id] || 0).padStart(10) + '  ' + (nameById[id] || '(unknown id)'));
}
