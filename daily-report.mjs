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

// --- Facebook boost / ad tracking ---
// Update when a boost goes live or ends. baselineDevices = the all-time device
// total at the moment the boost started (so "new devices since" = growth from it).
const BOOST = {
  active: true,
  startedAt: '2026-06-30T22:00:00Z', // ~6:00 PM ET, Jun 30 2026
  baselineDevices: 32,
  note: '$10/day, 4 days, Findlay +25mi, engagement goal',
};

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

// Since-boost metrics (only when a boost is flagged active).
let boostLine = null;
if (BOOST.active) {
  const [opensSince, actionsSince] = await Promise.all([
    count(`app_events?select=id&event=eq.app_open&created_at=gte.${BOOST.startedAt}`),
    count(`app_events?select=id&event=neq.app_open&created_at=gte.${BOOST.startedAt}`),
  ]);
  const evSince = await rows(`app_events?select=device_id&created_at=gte.${BOOST.startedAt}&limit=8000`);
  const devActiveSince = new Set(evSince.map((e) => e.device_id).filter(Boolean)).size;
  const hrs = Math.max(1, Math.round((Date.now() - new Date(BOOST.startedAt).getTime()) / 3600000));
  const newDev = devTotal - BOOST.baselineDevices;
  boostLine = { hrs, newDev, devActiveSince, opensSince, actionsSince };
}

const fmtMap = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || '—';
const stamp = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

// Capture the printed report so `--email` can also mail it to the owner.
const REPORT = [];
const _log = console.log;
console.log = (...a) => { REPORT.push(a.map(String).join(' ')); _log(...a); };

console.log(`\n================  LOCAL LOOP — DAILY REPORT  ================`);
console.log(`  ${stamp}\n`);
console.log(`  INSTALLS`);
console.log(`    Total installs:         ${devTotal}   (devices that have opened the app)`);
console.log(`  REACH — app opens`);
console.log(`    Opened (last 24h):      ${dev24}`);
console.log(`    By town (24h):          ${fmtMap(byCity)}`);
console.log(`  ENGAGEMENT — in-app actions (taps), excludes opens`);
console.log(`    Actions (last 24h):     ${act24}   |   all-time ${actTotal}`);
console.log(`    Active devices (24h):   ${activeDevs.size}   (openers who tapped something)`);
console.log(`    Action mix (24h):       ${fmtMap(byType)}`);
console.log(`    Top searches (24h):     ${fmtMap(searches)}`);
if (boostLine) {
  console.log(`  SINCE BOOST — ${BOOST.note}`);
  console.log(`    Live for:               ${boostLine.hrs}h`);
  console.log(`    New devices since:      ${boostLine.newDev >= 0 ? '+' + boostLine.newDev : boostLine.newDev}   (${BOOST.baselineDevices} -> ${devTotal} all-time)`);
  console.log(`    Devices active since:   ${boostLine.devActiveSince}`);
  console.log(`    Opens / actions since:  ${boostLine.opensSince} opens · ${boostLine.actionsSince} actions`);
}
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
console.log = _log;

// A phone-friendly HTML email built from the raw values (not the fixed-width
// terminal text, which is unreadable on a narrow screen). Table layout with
// stacked rows so it reflows cleanly in Gmail / iOS Mail.
function buildReportHtml() {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const big = (v) => `<span style="font-size:23px;font-weight:800;color:#191919;">${esc(v)}</span>`;
  const muted = (s) => `<span style="color:#8a8a8a;font-size:14px;">${esc(s)}</span>`;
  const sec = (title, inner) => `<tr><td style="padding:14px 18px;border-bottom:1px solid #efede8;"><div style="font-size:11px;font-weight:700;letter-spacing:.8px;color:#1F6F54;margin-bottom:6px;">${title}</div>${inner}</td></tr>`;
  const trendRows = trendDays.map(([d, dev, act]) => `<tr><td style="padding:4px 0;color:#555;font-size:13px;">${esc(d)}${d === todayKey ? ' <span style="color:#B85C12;">(today)</span>' : ''}</td><td style="padding:4px 0;text-align:right;font-size:13px;color:#191919;"><b>${dev}</b> opens</td><td style="padding:4px 0;text-align:right;font-size:13px;color:#8a8a8a;">${act} taps</td></tr>`).join('');
  const boostSec = boostLine ? sec('SINCE THE AD BOOST', `<div>${big((boostLine.newDev >= 0 ? '+' : '') + boostLine.newDev)} new devices ${muted('(' + BOOST.baselineDevices + ' to ' + devTotal + ', over ' + boostLine.hrs + 'h)')}</div><div style="font-size:14px;color:#555;margin-top:4px;">${boostLine.opensSince} opens and ${boostLine.actionsSince} taps since it started</div>`) : '';
  return `<div style="background:#f4f2ee;padding:16px 10px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">`
    + `<tr><td style="background:#1F6F54;padding:20px 18px;"><div style="color:#cfe6dd;font-size:12px;letter-spacing:1.5px;font-weight:700;">LOCAL LOOP &middot; DAILY REPORT</div><div style="color:#ffffff;font-size:20px;font-weight:800;margin-top:3px;">${esc(stamp)}</div></td></tr>`
    + sec('INSTALLS', `<div>${big(devTotal)} <span style="font-size:15px;">total installs</span></div><div style="font-size:13px;color:#8a8a8a;margin-top:3px;">devices that have opened the app</div>`)
    + sec('REACH &middot; app opens', `<div>${big(dev24)} today</div><div style="font-size:14px;color:#555;margin-top:4px;">By town: ${esc(fmtMap(byCity))}</div>`)
    + sec('ENGAGEMENT &middot; taps', `<div>${big(act24)} today ${muted('· ' + actTotal + ' all-time')}</div><div style="font-size:14px;color:#555;margin-top:4px;">${activeDevs.size} active devices</div><div style="font-size:14px;color:#555;margin-top:2px;">${esc(fmtMap(byType))}</div>${Object.keys(searches).length ? `<div style="font-size:14px;color:#555;margin-top:2px;">Top searches: ${esc(fmtMap(searches))}</div>` : ''}`)
    + boostSec
    + sec('SUBMISSIONS', `<div style="font-size:14px;color:#333;line-height:1.7;">Events: <b>${evUser24}</b> today <span style="color:#8a8a8a;">(${evUserTotal} all-time)</span><br>Garage sales: <b>${gs24}</b> today <span style="color:#8a8a8a;">(${gsTotal})</span><br>Food trucks: <b>${ft24}</b> today <span style="color:#8a8a8a;">(${ftTotal})</span></div>`)
    + sec('7-DAY TREND', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${trendRows}</table>`)
    + sec('CONTENT', `<div>${big(eventsLive)} <span style="font-size:15px;">live events in the app</span></div>`)
    + `<tr><td style="padding:14px 18px;background:#faf9f6;font-size:12px;color:#9a9a9a;line-height:1.6;">"Opens" is the in-app proxy; true installs live in App Store Connect, Analytics (Apple lags about a day). The 24h headline is a rolling window, so it will not match a single trend row.</td></tr>`
    + `</table></div>`;
}

// Deliver the report to the owner's inbox (so the morning run doesn't vanish
// into a background session). Run: node daily-report.mjs --email
if (process.argv.includes('--email')) {
  try {
    const key = g('RESEND_API_KEY');
    if (!key) throw new Error('missing RESEND_API_KEY in .env');
    const day = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Local Loop <noreply@findlayevents.com>',
        to: ['michabw91@gmail.com'],
        subject: `Local Loop daily report: ${day}`,
        text: REPORT.join('\n'),
        html: buildReportHtml(),
      }),
    });
    if (!r.ok) throw new Error('Resend ' + r.status + ': ' + (await r.text()).slice(0, 200));
    _log('  [report emailed to michabw91@gmail.com]');
  } catch (e) {
    console.error('  email failed:', e.message);
  }
}
