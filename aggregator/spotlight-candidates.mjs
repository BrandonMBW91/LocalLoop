// Prints today's spotlight CANDIDATES per town: tonight's and tomorrow's
// events with view counts, so a human/Claude can judge whether anything is a
// true big hitter worth a spotlight push. Read-only.
//
//   node spotlight-candidates.mjs      (from aggregator/)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const env = readFileSync(join(ROOT, '.env'), 'utf8') + '\n' + readFileSync(join(ROOT, 'aggregator', '.env'), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const SB = g('EXPO_PUBLIC_SUPABASE_URL') || g('SUPABASE_URL');
const KEY = g('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

const TZ = 'America/New_York';
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const now = new Date();
const today = dayKey(now);
const tomorrow = dayKey(new Date(Date.now() + 86400000));

// towns that currently have push-enabled devices — a spotlight to a town with
// zero opted-in devices is pointless.
const tokRes = await fetch(`${SB}/rest/v1/push_tokens?select=city_id`, { headers: H });
const tokens = await tokRes.json();
const tokenTowns = {};
for (const t of tokens) tokenTowns[t.city_id || 'findlay'] = (tokenTowns[t.city_id || 'findlay'] || 0) + 1;
console.log('push-enabled devices by town:', JSON.stringify(tokenTowns));
console.log(`now (ET): ${new Date().toLocaleString('en-US', { timeZone: TZ })}`);

const from = new Date().toISOString();
const to = new Date(Date.now() + 2 * 86400000).toISOString();
const r = await fetch(`${SB}/rest/v1/events?select=city_id,title,category,start_at,venue,view_count&status=eq.approved&start_at=gte.${from}&start_at=lte.${to}&order=view_count.desc.nullslast&limit=200`, { headers: H });
const events = await r.json();

for (const town of Object.keys(tokenTowns)) {
  const townEvents = events.filter((e) => e.city_id === town);
  if (!townEvents.length) { console.log(`\n== ${town}: no events in the next 48h ==`); continue; }
  console.log(`\n== ${town} (${tokenTowns[town]} device${tokenTowns[town] === 1 ? '' : 's'}) ==`);
  for (const e of townEvents.slice(0, 15)) {
    const d = new Date(e.start_at);
    const k = dayKey(d);
    const when = k === today ? 'TODAY' : k === tomorrow ? 'tomorrow' : k;
    const time = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    console.log(`  [${e.view_count || 0} views] ${when} ${time} · ${e.category} · ${e.title.slice(0, 60)} @ ${String(e.venue).slice(0, 40)}`);
  }
}
