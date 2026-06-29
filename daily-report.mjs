// Local Loop — daily app report. Pulls live metrics from Supabase (service role)
// and prints a readable summary. Run: `node daily-report.mjs`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const read = (p) => { try { return readFileSync(join(DIR, p), 'utf8'); } catch { return ''; } };
const env = read('.env') + '\n' + read('aggregator/.env');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const URL = g('EXPO_PUBLIC_SUPABASE_URL');
const KEY = g('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

const dayAgo = new Date(Date.now() - 86400000).toISOString();

async function count(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  return Number((r.headers.get('content-range') || '/0').split('/')[1]) || 0;
}
async function rows(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: H });
  return r.ok ? r.json() : [];
}

const [
  devTotal, dev24, actTotal, act24,
  evUserTotal, evUser24, gsTotal, gs24, ftTotal, ft24,
  eventsLive,
] = await Promise.all([
  count('device_activity?select=device_id'),
  count(`device_activity?select=device_id&last_seen=gte.${dayAgo}`),
  count('app_events?select=id'),
  count(`app_events?select=id&created_at=gte.${dayAgo}`),
  count('events?select=id&source_uid=is.null'),
  count(`events?select=id&source_uid=is.null&created_at=gte.${dayAgo}`),
  count('garage_sales?select=id'),
  count(`garage_sales?select=id&created_at=gte.${dayAgo}`),
  count('food_trucks?select=id'),
  count(`food_trucks?select=id&created_at=gte.${dayAgo}`),
  count('events?select=id&status=eq.approved'),
]);

// engagement breakdown + top searches (last 24h)
const evs = await rows(`app_events?select=event,props&created_at=gte.${dayAgo}&limit=2000`);
const byType = {};
const searches = {};
for (const e of evs) {
  byType[e.event] = (byType[e.event] || 0) + 1;
  if (e.event === 'search' && e.props && e.props.term) searches[e.props.term] = (searches[e.props.term] || 0) + 1;
}
const byCity = {};
for (const d of await rows(`device_activity?select=city_id&last_seen=gte.${dayAgo}`)) byCity[d.city_id] = (byCity[d.city_id] || 0) + 1;

// 7-day trend, bucketed by local calendar day (so an ad-driven bump is visible).
const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
const weekEvs = await rows(`app_events?select=event,device_id,created_at&created_at=gte.${weekAgo}&limit=5000`);
const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA'); // YYYY-MM-DD local
const trend = {};
for (const e of weekEvs) {
  const k = dayKey(e.created_at);
  (trend[k] = trend[k] || { devices: new Set(), actions: 0 });
  trend[k].devices.add(e.device_id);
  trend[k].actions += 1;
}
const trendDays = [];
for (let i = 6; i >= 0; i--) {
  const k = new Date(Date.now() - i * 86400000).toLocaleDateString('en-CA');
  const t = trend[k] || { devices: new Set(), actions: 0 };
  trendDays.push([k, t.devices.size, t.actions]);
}

const fmtMap = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '—';
const today = new Date().toISOString().slice(0, 10);

console.log(`\n================  LOCAL LOOP — DAILY REPORT  ================`);
console.log(`  ${today}  (last-24h vs. all-time)\n`);
console.log(`  REACH`);
console.log(`    Devices opened app:     ${dev24} today   |   ${devTotal} total`);
console.log(`    By town (24h):          ${fmtMap(byCity)}`);
console.log(`  ENGAGEMENT`);
console.log(`    In-app actions:         ${act24} today   |   ${actTotal} total`);
console.log(`    Action mix (24h):       ${fmtMap(byType)}`);
console.log(`    Top searches (24h):     ${fmtMap(searches)}`);
console.log(`  USER SUBMISSIONS (people posting their own content)`);
console.log(`    Events:                 ${evUser24} today   |   ${evUserTotal} total`);
console.log(`    Garage sales:           ${gs24} today   |   ${gsTotal} total`);
console.log(`    Food trucks:            ${ft24} today   |   ${ftTotal} total`);
console.log(`  7-DAY TREND  (active devices / actions, by day)`);
for (const [d, dev, act] of trendDays) {
  const bar = '#'.repeat(Math.min(dev, 40));
  console.log(`    ${d}   ${String(dev).padStart(3)} dev  ${String(act).padStart(4)} act  ${bar}`);
}
console.log(`  CONTENT`);
console.log(`    Live events (feeds):    ${eventsLive}`);
console.log(`\n  Note: App Store downloads live in App Store Connect -> Analytics`);
console.log(`  (Apple lags ~1 day); the device count above is the live proxy.`);
console.log(`=============================================================\n`);
