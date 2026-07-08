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

// The "day" window is the PREVIOUS full calendar day, local time (midnight to
// midnight) — so the headline reflects one complete day, not a rolling 24h that
// straddles today's partial data. dayStart = yesterday 00:00, dayEnd = today 00:00.
const now = new Date();
const dayEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // today 00:00 local
const dayStartDate = new Date(dayEndDate.getTime() - 86400000);                // yesterday 00:00 local
const dayStart = dayStartDate.toISOString();
const dayEnd = dayEndDate.toISOString();
const dayLabel = dayStartDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

// --- Facebook boost / ad tracking ---
// baselineDevices = all-time device total when the boost started.
// When a boost ends: set active=false, fill in endedAt + endDevices (the all-time
// device total the moment it ended). Metrics are then frozen to the [startedAt,
// endedAt] window so organic growth after the ad doesn't keep inflating them.
// When a new boost starts: set active=true, reset startedAt/baselineDevices,
// clear endedAt/endDevices.
const BOOST = {
  active: false,
  startedAt: '2026-06-30T22:00:00Z', // ~6:00 PM ET, Jun 30 2026
  endedAt: '2026-07-06T12:00:00Z',   // ad has ended
  baselineDevices: 32,
  endDevices: 80,                    // all-time device total when the ad ended
  note: '$10/day, Findlay +25mi, engagement goal',
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
  devTotal,
  actTotal,
  evUserTotal, evUser24, gsTotal, gs24, ftTotal, ft24,
  eventsLive,
] = await Promise.all([
  count('device_activity?select=device_id'),
  count('app_events?select=id&event=neq.app_open'),
  count('events?select=id&source_uid=is.null'),
  count(`events?select=id&source_uid=is.null&created_at=gte.${dayStart}&created_at=lt.${dayEnd}`),
  count('garage_sales?select=id'),
  count(`garage_sales?select=id&created_at=gte.${dayStart}&created_at=lt.${dayEnd}`),
  count('food_trucks?select=id'),
  count(`food_trucks?select=id&created_at=gte.${dayStart}&created_at=lt.${dayEnd}`),
  count('events?select=id&status=eq.approved'),
]);

// Per-device city + platform, looked up so the day's opens can be attributed to a
// town/platform accurately even when a device has reopened since (device_activity
// only keeps the latest last_seen per device, so filtering it by a past day would
// drop returning devices).
const platName = (p) => (p === 'ios' ? 'iOS' : p === 'android' ? 'Android' : 'unknown');
const daInfo = {};
const byPlatform = {};
for (const d of await rows('device_activity?select=device_id,city_id,platform')) {
  daInfo[d.device_id] = { city: d.city_id, platform: d.platform };
  const k = platName(d.platform); byPlatform[k] = (byPlatform[k] || 0) + 1;
}

// The day's activity, straight from app_events for the previous calendar day.
// Opened = distinct devices with ANY event that day (matches the trend's per-day
// device count); actions = taps only (app_open excluded). Since the 1.0.1 update
// every open logs an app_open, so this is a complete picture for a recent day.
const dayEvs = await rows(`app_events?select=event,device_id,props&created_at=gte.${dayStart}&created_at=lt.${dayEnd}&limit=8000`);
const openDevs = new Set();
const activeDevs = new Set();
const byType = {};
const searches = {};
let act24 = 0;
for (const e of dayEvs) {
  if (e.device_id) openDevs.add(e.device_id);
  if (e.event === 'app_open') continue;
  act24 += 1;
  byType[e.event] = (byType[e.event] || 0) + 1;
  if (e.device_id) activeDevs.add(e.device_id);
  if (e.event === 'search' && e.props && e.props.term) searches[e.props.term] = (searches[e.props.term] || 0) + 1;
}
const dev24 = openDevs.size;

// Town + platform breakdown of the devices that opened that day.
const byCity = {};
const byPlatform24 = {};
for (const id of openDevs) {
  const info = daInfo[id] || {};
  const c = info.city || 'unknown'; byCity[c] = (byCity[c] || 0) + 1;
  const k = platName(info.platform); byPlatform24[k] = (byPlatform24[k] || 0) + 1;
}

// Real user posts: created_by is set = a signed-in local. Our own curated posts
// come in via the service role with no created_by, so this filters them out.
const uPostWhen = (t) => { const d = Math.floor((Date.now() - new Date(t)) / 86400000); return d <= 0 ? 'today' : d === 1 ? '1d ago' : d + 'd ago'; };
const [uEv, uGs, uFt] = await Promise.all([
  rows(`events?select=title,city_id,created_at&source_uid=is.null&created_by=not.is.null&created_at=gte.${weekAgo}&order=created_at.desc`),
  rows(`garage_sales?select=title,city_id,created_at&created_by=not.is.null&created_at=gte.${weekAgo}&order=created_at.desc`),
  rows(`food_trucks?select=name,city_id,created_at&created_by=not.is.null&created_at=gte.${weekAgo}&order=created_at.desc`),
]);
const userPosts = [
  ...uEv.map((x) => ({ kind: 'Event', title: x.title, town: x.city_id, at: x.created_at })),
  ...uGs.map((x) => ({ kind: 'Sale', title: x.title, town: x.city_id, at: x.created_at })),
  ...uFt.map((x) => ({ kind: 'Truck', title: x.name, town: x.city_id, at: x.created_at })),
].sort((a, b) => new Date(b.at) - new Date(a.at));
const userPosts24 = userPosts.filter((p) => p.at >= dayStart && p.at < dayEnd).length;

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

// Boost metrics — measured over the ad window [startedAt, endedAt|now]. Shown
// while the ad is live and retrospectively after it ends (frozen to the window).
let boostLine = null;
if (BOOST.startedAt && (BOOST.active || BOOST.endedAt)) {
  const end = BOOST.active ? null : BOOST.endedAt;
  const lte = end ? `&created_at=lte.${end}` : '';
  const [opensSince, actionsSince] = await Promise.all([
    count(`app_events?select=id&event=eq.app_open&created_at=gte.${BOOST.startedAt}${lte}`),
    count(`app_events?select=id&event=neq.app_open&created_at=gte.${BOOST.startedAt}${lte}`),
  ]);
  const evSince = await rows(`app_events?select=device_id&created_at=gte.${BOOST.startedAt}${lte}&limit=8000`);
  const devActiveSince = new Set(evSince.map((e) => e.device_id).filter(Boolean)).size;
  const endMs = end ? new Date(end).getTime() : Date.now();
  const days = Math.max(1, Math.round((endMs - new Date(BOOST.startedAt).getTime()) / 86400000));
  // While live, new devices = growth to now; once ended, frozen to endDevices.
  const finalDev = BOOST.active ? devTotal : (BOOST.endDevices ?? devTotal);
  const newDev = finalDev - BOOST.baselineDevices;
  boostLine = { days, newDev, finalDev, devActiveSince, opensSince, actionsSince, ended: !BOOST.active };
}

const fmtMap = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || '—';
const stamp = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

// Capture the printed report so `--email` can also mail it to the owner.
const REPORT = [];
const _log = console.log;
console.log = (...a) => { REPORT.push(a.map(String).join(' ')); _log(...a); };

console.log(`\n================  LOCAL LOOP — DAILY REPORT  ================`);
console.log(`  ${stamp}`);
console.log(`  Day figures below are for ${dayLabel} (full day, midnight to midnight)\n`);
console.log(`  INSTALLS`);
console.log(`    Total installs:         ${devTotal}   (devices that have opened the app)`);
  console.log(`    By platform (all):      ${fmtMap(byPlatform)}`);
  console.log(`    By platform (${dayLabel}):  ${fmtMap(byPlatform24)}`);
console.log(`  REACH — app opens`);
console.log(`    Opened (${dayLabel}):      ${dev24}`);
console.log(`    By town:                ${fmtMap(byCity)}`);
console.log(`  ENGAGEMENT — in-app actions (taps), excludes opens`);
console.log(`    Actions (${dayLabel}):     ${act24}   |   all-time ${actTotal}`);
console.log(`    Active devices:         ${activeDevs.size}   (openers who tapped something)`);
console.log(`    Action mix:             ${fmtMap(byType)}`);
console.log(`    Top searches:           ${fmtMap(searches)}`);
if (boostLine) {
  console.log(`  ${boostLine.ended ? 'AD BOOST (ended)' : 'SINCE BOOST'} — ${BOOST.note}`);
  console.log(`    ${boostLine.ended ? 'Ran for:' : 'Live for:'}                ${boostLine.days} days`);
  console.log(`    Devices added:          ${boostLine.newDev >= 0 ? '+' + boostLine.newDev : boostLine.newDev}   (${BOOST.baselineDevices} -> ${boostLine.finalDev} all-time)`);
  console.log(`    Devices active:         ${boostLine.devActiveSince}`);
  console.log(`    Opens / actions:        ${boostLine.opensSince} opens · ${boostLine.actionsSince} actions`);
}
console.log(`  SUBMISSIONS — content posted (includes our own listings)`);
console.log(`    Events:                 ${evUser24} on ${dayLabel}   |   all-time ${evUserTotal}`);
console.log(`    Garage sales:           ${gs24} on ${dayLabel}   |   all-time ${gsTotal}`);
console.log(`    Food trucks:            ${ft24} on ${dayLabel}   |   all-time ${ftTotal}`);
console.log(`  NEW USER POSTS — real locals (${userPosts24} on ${dayLabel}, last 7 days below)`);
if (userPosts.length) {
  userPosts.slice(0, 10).forEach((p) => console.log(`    ${uPostWhen(p.at).padEnd(7)} ${p.kind.padEnd(6)} ${p.title}  ·  ${p.town || '?'}`));
} else {
  console.log(`    none in the last 7 days`);
}
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
console.log(`  • Day figures cover the previous full calendar day (midnight to`);
console.log(`    midnight, local), so they match that day's row in the trend below.`);
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
  const sec = (title, inner) => `<tr><td style="padding:14px 18px;border-bottom:1px solid #efede8;"><div style="font-size:11px;font-weight:700;letter-spacing:.8px;color:#15315B;margin-bottom:6px;">${title}</div>${inner}</td></tr>`;
  const trendRows = trendDays.map(([d, dev, act]) => `<tr><td style="padding:4px 0;color:#555;font-size:13px;">${esc(d)}${d === todayKey ? ' <span style="color:#B22234;">(today)</span>' : ''}</td><td style="padding:4px 0;text-align:right;font-size:13px;color:#191919;"><b>${dev}</b> opens</td><td style="padding:4px 0;text-align:right;font-size:13px;color:#8a8a8a;">${act} taps</td></tr>`).join('');
  const boostSec = boostLine ? sec(boostLine.ended ? 'AD BOOST (ended)' : 'SINCE THE AD BOOST', `<div>${big((boostLine.newDev >= 0 ? '+' : '') + boostLine.newDev)} new devices ${muted('(' + BOOST.baselineDevices + ' to ' + boostLine.finalDev + ', over ' + boostLine.days + ' days)')}</div><div style="font-size:14px;color:#555;margin-top:4px;">${boostLine.opensSince} opens and ${boostLine.actionsSince} taps ${boostLine.ended ? 'during the ad' : 'since it started'}</div>`) : '';
  return `<div style="background:#f4f2ee;padding:16px 10px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">`
    + `<tr><td style="background:#15315B;padding:20px 18px;"><div style="color:#c9d4e8;font-size:12px;letter-spacing:1.5px;font-weight:700;">LOCAL LOOP &middot; DAILY REPORT</div><div style="color:#ffffff;font-size:20px;font-weight:800;margin-top:3px;">${esc(stamp)}</div><div style="color:#9db0cf;font-size:13px;margin-top:4px;">Day figures for ${esc(dayLabel)} &middot; full day, midnight to midnight</div></td></tr>`
    + sec('INSTALLS', `<div>${big(devTotal)} <span style="font-size:15px;">total installs</span></div><div style="font-size:13px;color:#8a8a8a;margin-top:3px;">devices that have opened the app</div>`)
    + sec('REACH &middot; app opens', `<div>${big(dev24)} ${muted('opened ' + dayLabel)}</div><div style="font-size:14px;color:#555;margin-top:4px;">By town: ${esc(fmtMap(byCity))}</div>`)
    + sec('BY PLATFORM &middot; iOS vs Android', `<div style="font-size:14px;color:#555;line-height:1.8;">All installs: <b>${esc(fmtMap(byPlatform))}</b><br>Opened ${esc(dayLabel)}: ${esc(fmtMap(byPlatform24))}</div>`)
    + sec('ENGAGEMENT &middot; taps', `<div>${big(act24)} ${muted('on ' + dayLabel + ' · ' + actTotal + ' all-time')}</div><div style="font-size:14px;color:#555;margin-top:4px;">${activeDevs.size} active devices</div><div style="font-size:14px;color:#555;margin-top:2px;">${esc(fmtMap(byType))}</div>${Object.keys(searches).length ? `<div style="font-size:14px;color:#555;margin-top:2px;">Top searches: ${esc(fmtMap(searches))}</div>` : ''}`)
    + boostSec
    + sec('SUBMISSIONS', `<div style="font-size:14px;color:#333;line-height:1.7;">Events: <b>${evUser24}</b> on ${esc(dayLabel)} <span style="color:#8a8a8a;">(${evUserTotal} all-time)</span><br>Garage sales: <b>${gs24}</b> <span style="color:#8a8a8a;">(${gsTotal})</span><br>Food trucks: <b>${ft24}</b> <span style="color:#8a8a8a;">(${ftTotal})</span></div>`)
    + (userPosts.length ? sec('NEW USER POSTS &middot; real locals', `<div style="font-size:12px;color:#8a8a8a;margin-bottom:6px;">${userPosts24} on ${esc(dayLabel)}</div>` + userPosts.slice(0, 8).map((p) => `<div style="font-size:14px;color:#333;margin:5px 0;"><b>${esc(p.title)}</b><br><span style="color:#8a8a8a;font-size:13px;">${esc(p.kind + ' · ' + (p.town || '?') + ' · ' + uPostWhen(p.at))}</span></div>`).join('')) : '')
    + sec('7-DAY TREND', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${trendRows}</table>`)
    + sec('CONTENT', `<div>${big(eventsLive)} <span style="font-size:15px;">live events in the app</span></div>`)
    + `<tr><td style="padding:14px 18px;background:#faf9f6;font-size:12px;color:#9a9a9a;line-height:1.6;">"Opens" is the in-app proxy; true installs live in App Store Connect, Analytics (Apple lags about a day). Day figures cover the previous full calendar day (midnight to midnight, local), so they match that day's row in the 7-day trend.</td></tr>`
    + `</table></div>`;
}

// Deliver the report to the owner's inbox (so the morning run doesn't vanish
// into a background session). Run: node daily-report.mjs --email
if (process.argv.includes('--email')) {
  try {
    const key = g('RESEND_API_KEY');
    if (!key) throw new Error('missing RESEND_API_KEY in .env');
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Local Loop <noreply@findlayevents.com>',
        to: ['michabw91@gmail.com'],
        subject: `Local Loop daily report: ${dayLabel}`,
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
