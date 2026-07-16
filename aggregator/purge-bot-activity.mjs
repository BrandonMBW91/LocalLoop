// Remove crawler-generated rows from the user metrics.
//
// A JS-rendering crawler followed the SEO pages' "Open in Local Loop" link into
// the app. Bots keep no localStorage, so makeDeviceId() minted a NEW anonymous
// device on every single page — inflating device_activity (the metric that sets
// per-town ad pricing) and app_events. They are identifiable with certainty:
// makeDeviceId is `d_` + Date.now().toString(36) + Math.random().toString(36),
// and this client's JS engine reseeds identically per fresh context, so every
// one of its devices shares the SAME 8-char random suffix. Real humans keep one
// device across visits, so a shared suffix across many devices cannot be human.
//
// Deliberately conservative: only suffix groups at or above MIN_GROUP are
// touched, so a genuine 1-in-4-billion collision between two people is ignored.
//
//   node purge-bot-activity.mjs           dry run
//   node purge-bot-activity.mjs --apply   delete
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';

const APPLY = process.argv.includes('--apply');
const MIN_GROUP = 5; // devices sharing one RNG suffix before we call it automated
loadDotEnv();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

let rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('device_activity')
    .select('device_id,city_id,platform,last_seen').range(from, from + 999);
  if (error) { console.error('read ERR', error.message); process.exit(1); }
  rows.push(...(data || []));
  if (!data || data.length < 1000) break;
}

const web = rows.filter((r) => r.platform === 'web');
const bySuffix = new Map();
for (const r of web) {
  const s = String(r.device_id).slice(-8);
  if (!bySuffix.has(s)) bySuffix.set(s, []);
  bySuffix.get(s).push(r);
}
const botGroups = [...bySuffix.entries()].filter(([, g]) => g.length >= MIN_GROUP);
const botIds = botGroups.flatMap(([, g]) => g.map((r) => r.device_id));

console.log(`device_activity rows: ${rows.length} (web: ${web.length})`);
for (const [suffix, g] of botGroups) {
  const towns = [...new Set(g.map((r) => r.city_id))];
  console.log(`  suffix ${suffix}: ${g.length} devices | towns: ${towns.join(', ')} | ${g[0].last_seen.slice(0, 16)} -> ${g[g.length - 1].last_seen.slice(0, 16)}`);
}
console.log(`bot devices to remove: ${botIds.length}`);
console.log(`real web devices remaining: ${web.length - botIds.length}`);

if (!botIds.length) process.exit(0);
if (!APPLY) { console.log('(dry run — use --apply)'); process.exit(0); }

let devDeleted = 0, evDeleted = 0;
for (let i = 0; i < botIds.length; i += 100) {
  const batch = botIds.slice(i, i + 100);
  const { error: e1 } = await sb.from('app_events').delete().in('device_id', batch);
  if (e1) console.error('app_events del ERR', e1.message); else evDeleted += batch.length;
  const { error: e2 } = await sb.from('device_activity').delete().in('device_id', batch);
  if (e2) console.error('device_activity del ERR', e2.message); else devDeleted += batch.length;
}
console.log(`applied: removed ${devDeleted} bot devices and their app_events (${evDeleted} batches ok)`);
