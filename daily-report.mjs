// Local Loop — daily app report. Pulls live metrics from Supabase (service role)
// and prints a readable summary. Run: `node daily-report.mjs`
//
// Two distinct "device" metrics, kept clearly separate so the report stays honest:
//   • OPENED  — devices that launched the app. Source: device_activity (upsert,
//               one row per device, last_seen) for the live 24h count, plus the
//               historical `app_open` events in app_events for the daily trend.
//   • ACTIVE  — devices that took an in-app action (tap an event, save, etc.).
//               Source: app_events excluding `app_open`.
// "Opened" is always >= "active": every active device opened, but most openers
// don't tap into anything.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const read = (p) => { try { return readFileSync(join(DIR, p), 'utf8'); } catch { return ''; } };
const env = read('.env') + '\n' + read('aggregator/.env');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const SB = g('EXPO_PUBLIC_SUPABASE_URL');
const KEY = g('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

const dayAgo = new Date(Date.now() - 86400000).toISOString();
const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

async function count(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  return Number((r.headers.get('content-range') || '/0').split('/')[1]) || 0;
}
async function rows(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  return r.ok ? r.json() : [];
}

const [
  devTotal, dev24,
  actTotal,
  evUserTotal, evUser24, gsTotal, gs24, ftTotal, ft24,
  eventsLive,
] = await Promise.all([
  count('device_activity?select=device_id'),
  count(`device_activity?select=device_id&last_seen=gte.${dayAgo}`),
  count('app_events?select=id&event=neq.app_open'),
  count('events?select=id&source_uid=is.null'),
  count(`events?select=id&source_uid=is.null&created_at=gte.${dayAgo}`),
  count('garage_sales?select=id'),
  count(`garage_sales?select=id&created_at=gte.${dayAgo}`),
  count('food_trucks?select=id'),
  count(`food_trucks?select=id&created_at=gte.${dayAgo}`),
  count('events?select=id&status=eq.approved'),
]);

// Engagement (last 24h): action mix + distinct active devices. app_open is an
// open, not an action, so it's excluded from the action counts/mix.
const evs24 = await rows(`app_events?select=event,device_id,props&created_at=gte.${dayAgo}&limit=3000`);
const actEvs = evs24.filter((e) => e.event !== 'app_open');
const byType = {};
const searches = {};
const activeDevs = new Set();
for (const e of actEvs) {
  byType[e.event] = (byType[e.event] || 0) + 1;
  if (e.device_id) activeDevs.add(e.device_id);
  if (e.event === 'search' && e.props && e.props.term) searches[e.props.term] = (searches[e.props.term] || 0) + 1;
}
const act24 = actEvs.length;

const byCity = {};
for (const d of await rows(`device_activity?select=city_id&last_seen=gte.${dayAgo}`)) byCity[d.city_id] = (byCity[d.city_id] || 0) + 1;

// 7-day trend, bucketed by local calendar day. "active" = distinct devices that
// did anything that day (includes openers via app_open going forward); "actions"
// = taps only (excludes app_open).
const weekEvs = await rows(`app_events?select=event,device_id,created_at&created_at=gte.${weekAgo}&limit=8000`);
const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA'); // YYYY-MM-DD local
const trend = {};
for (const e of weekEvs) {
  const k = dayKey(e.created_at);
  (trend[k] = trend[k] || { devices: new Set(), actions: 0 });
  if (e.device_id) trend[k].devices.add(e.device_id);
  if (e.event !== 'app_open') trend[k].actions += 1;
}
const todayKey = new Date().toLocaleDateString('en-CA');
const trendDays = [];
for (let i = 6; i >= 0; i--) {
  const k = new Date(Date.now() - i * 86400000).toLocaleDateString('en-CA');
  const t = trend[k] || { devices: new Set(), actions: 0 };
  trendDays.push([k, t.devices.size, t.actions]);
}

const fmtMap = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || '—';
const stamp = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

console.log(`\n================  LOCAL LOOP — DAILY REPORT  ================`);
console.log(`  ${stamp}\n`);
console.log(`  REACH — devices that opened the app`);
console.log(`    Opened (last 24h):      ${dev24}   |   all-time ${devTotal}`);
console.log(`    By town (24h):          ${fmtMap(byCity)}`);
console.log(`  ENGAGEMENT — in-app actions (taps), excludes opens`);
console.log(`    Actions (last 24h):     ${act24}   |   all-time ${actTotal}`);
console.log(`    Active devices (24h):   ${activeDevs.size}   (openers who tapped something)`);
console.log(`    Action mix (24h):       ${fmtMap(byType)}`);
console.log(`    Top searches (24h):     ${fmtMap(searches)}`);
console.log(`  SUBMISSIONS — content posted (includes our own listings)`);
console.log(`    Events:                 ${evUser24} in 24h   |   all-time ${evUserTotal}`);
console.log(`    Garage sales:           ${gs24} in 24h   |   all-time ${gsTotal}`);
console.log(`    Food trucks:            ${ft24} in 24h   |   all-time ${ftTotal}`);
console.log(`  7-DAY TREND  (by calendar day · active devices / actions)`);
console.log(`    date          active  actions`);
for (const [d, dev, act] of trendDays) {
  const isToday = d === todayKey;
  const bar = '#'.repeat(Math.min(dev, 30));
  console.log(`    ${d}   ${String(dev).padStart(5)}  ${String(act).padStart(6)}  ${bar}${isToday ? '  (today, partial)' : ''}`);
}
console.log(`  CONTENT`);
console.log(`    Live events in feeds:   ${eventsLive}`);
console.log(`\n  Notes:`);
console.log(`  • "Opened" is the live in-app proxy; App Store installs are in App`);
console.log(`    Store Connect → Analytics (Apple lags ~1 day).`);
console.log(`  • The 24h headline is a rolling window, so it won't equal any single`);
console.log(`    calendar-day row in the trend.`);
console.log(`  • From the 1.0.1 update on, every app open is logged, so the trend's`);
console.log(`    "active" count now includes openers and lines up with Reach;`);
console.log(`    earlier days count only devices that tapped something.`);
console.log(`=============================================================\n`);
