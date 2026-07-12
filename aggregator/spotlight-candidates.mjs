// Prints spotlight CANDIDATES per town: tonight's and tomorrow's events with
// view counts, so a human/Claude can judge whether anything is a true big hitter
// worth a spotlight push. Read-only.
//
//   node spotlight-candidates.mjs                 (from aggregator/)
//   SPOTLIGHT_MIN_POP=25000 node spotlight-candidates.mjs   (raise the pop bar)
//
// We scan every town above a population bar (MIN_POP), not just the towns that
// happen to have opted-in devices today — so as the app grows into a new market
// its big events surface here automatically. Each town is annotated with its
// opted-in device count: a city-specific spotlight only reaches people if that
// town has devices; a truly regional moment can still go out as city_id "all".

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

// "decent population" bar. Below this a town is a village whose events (library
// storytimes, club meetings) aren't a broad enough draw to justify a push.
const MIN_POP = Number(process.env.SPOTLIGHT_MIN_POP || 10000);

const TZ = 'America/New_York';
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const now = new Date();
const today = dayKey(now);
const tomorrow = dayKey(new Date(Date.now() + 86400000));

// Towns worth scanning: population at or above the bar. Biggest first.
const decent = CITIES.filter((c) => (c.pop || 0) >= MIN_POP).sort((a, b) => (b.pop || 0) - (a.pop || 0));
const nameById = Object.fromEntries(CITIES.map((c) => [c.id, c.name]));

// Opted-in device counts, so we know which town sends would actually reach people.
// Paginated: PostgREST caps responses at ~1000 rows, and past 1000 opted-in
// devices an uncapped fetch would undercount towns arbitrarily.
const tokens = [];
for (let o = 0; ; o += 1000) {
  const tokRes = await fetch(`${SB}/rest/v1/push_tokens?select=city_id&order=token.asc&limit=1000&offset=${o}`, { headers: H });
  const page = await tokRes.json();
  if (!Array.isArray(page)) { console.error('push_tokens fetch failed:', JSON.stringify(page).slice(0, 150)); process.exit(1); }
  tokens.push(...page);
  if (page.length < 1000) break;
}
const devices = {};
for (const t of tokens) devices[t.city_id || 'findlay'] = (devices[t.city_id || 'findlay'] || 0) + 1;

const totalDevices = Object.values(devices).reduce((a, b) => a + b, 0);
console.log(`scanning ${decent.length} towns with pop >= ${MIN_POP.toLocaleString()} (of ${CITIES.length} total)`);
console.log(`opted-in devices: ${totalDevices} across ${Object.keys(devices).length} town(s) — ${JSON.stringify(devices)}`);
console.log(`now (ET): ${new Date().toLocaleString('en-US', { timeZone: TZ })}`);

// Pull approved events for the decent-pop towns from ET *midnight today* (NOT
// "now": the aggregator anchors all-day events to ET noon, so a 3:46 PM run
// with a now-based window systematically hid every all-day event happening
// today — fairs and festivals, exactly the big-hitter class this feeds).
// Still-running multi-day events (end_at in the future) are included too.
const offset = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
  .formatToParts(now).find((p) => p.type === 'timeZoneName').value.replace('GMT', '') || '+00:00';
const from = new Date(`${today}T00:00:00${offset}`).toISOString();
const to = new Date(Date.now() + 2 * 86400000).toISOString();
const nowIso = new Date().toISOString();
const idList = decent.map((c) => c.id).join(',');
// Paginated for the same ~1000-row server cap; without it the dropped rows are
// exactly the low/zero-view ones, silently skewing the view-count signal.
const events = [];
for (let o = 0; ; o += 1000) {
  const r = await fetch(`${SB}/rest/v1/events?select=city_id,title,category,start_at,end_at,venue,view_count&status=eq.approved&city_id=in.(${idList})&start_at=lte.${to}&or=(start_at.gte.${from},end_at.gte.${nowIso})&order=view_count.desc.nullslast,start_at.asc&limit=1000&offset=${o}`, { headers: H });
  const page = await r.json();
  if (!Array.isArray(page)) { console.error('events fetch failed:', JSON.stringify(page).slice(0, 150)); process.exit(1); }
  events.push(...page);
  if (page.length < 1000) break;
}

// Show towns that have devices first (a city-specific send is actionable there),
// then the rest; within each group, biggest town first. Skip towns with no events.
const withEvents = decent.filter((c) => events.some((e) => e.city_id === c.id));
withEvents.sort((a, b) => (devices[b.id] || 0) - (devices[a.id] || 0) || (b.pop || 0) - (a.pop || 0));

let shown = 0;
for (const town of withEvents) {
  const townEvents = events.filter((e) => e.city_id === town.id);
  const dev = devices[town.id] || 0;
  const devTag = dev ? `${dev} device${dev === 1 ? '' : 's'}` : 'no devices yet';
  console.log(`\n== ${town.name} · pop ${town.pop.toLocaleString()} · ${devTag} ==`);
  for (const e of townEvents.slice(0, 15)) {
    const d = new Date(e.start_at);
    const k = dayKey(d);
    const when = k === today ? 'TODAY' : k === tomorrow ? 'tomorrow' : k < today ? 'ongoing' : k;
    const time = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    console.log(`  [${e.view_count || 0} views] ${when} ${time} · ${e.category} · ${e.title.slice(0, 60)} @ ${String(e.venue).slice(0, 40)}`);
  }
  shown++;
}
if (!shown) console.log('\n(no events in the next 48h for any decent-population town)');
