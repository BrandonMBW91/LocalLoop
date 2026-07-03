// Static SEO page generator for Local Loop.
// Pulls upcoming approved events from Supabase and writes branded, Google-
// indexable HTML into site/events/ — a hub page plus one page per town, each
// with schema.org Event structured data (rich results) and an app-download CTA.
// The pages mirror the app's design: green town header with tagline, day-grouped
// sections, and app-style event cards (calendar date chip + category pill).
//
//   node generate-events.mjs        (from aggregator/)
//
// Env (from aggregator/.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { CITIES as APP_CITIES, REGION_ORDER } from '../src/data/cities.js';

loadDotEnv();

const APP_STORE_URL = 'https://apps.apple.com/app/id6780306721';
const SITE = 'https://localloop.io';
const HORIZON_DAYS = 45;
const TZ = 'America/New_York'; // CI runs in UTC — all day math must be Eastern

// Mirrors src/theme/theme.js colors.category — keep in sync with the app.
const CATEGORY = {
  Music: '#6A3FB0', Family: '#1C6A9E', Food: '#A85410', Sports: '#197A41',
  Arts: '#A62E6B', Community: '#1F6566', Market: '#786017', Education: '#34509E',
};
const GREEN = '#1F6F54';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'site', 'events');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Eastern-time date helpers ------------------------------------------------
function etParts(iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return {
    dow: get('weekday'), mon: get('month'), day: get('day'), year: get('year'),
    time: `${get('hour')}:${get('minute')} ${get('dayPeriod')}`.replace(':00 ', ' '),
  };
}
function etDayKey(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
function dayLabel(key, todayKey, tomorrowKey, sampleIso) {
  if (key === todayKey) return 'Today';
  if (key === tomorrowKey) return 'Tomorrow';
  const p = etParts(sampleIso);
  return `${p.dow}, ${p.mon} ${p.day}`;
}
function timeRange(e) {
  const s = etParts(e.start_at);
  if (!e.end_at) return s.time;
  const en = etParts(e.end_at);
  return etDayKey(e.start_at) === etDayKey(e.end_at) ? `${s.time} – ${en.time}` : s.time;
}

// --- shared page chrome --------------------------------------------------------
const PIN_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>`;
const CLOCK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
const LOGO_SVG = `<svg width="36" height="36" viewBox="0 0 1024 1024" aria-hidden="true"><rect width="1024" height="1024" rx="232" fill="#1F6F54"/><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" transform="translate(176 176) scale(28)" fill="#fff"/><rect x="468" y="376" width="16" height="34" rx="7" fill="#fff"/><rect x="540" y="376" width="16" height="34" rx="7" fill="#fff"/><rect x="432" y="392" width="160" height="150" rx="18" fill="#D9772B"/><rect x="448" y="452" width="128" height="8" fill="#fff"/><g fill="#fff"><rect x="462" y="474" width="20" height="20" rx="4"/><rect x="502" y="474" width="20" height="20" rx="4"/><rect x="542" y="474" width="20" height="20" rx="4"/><rect x="462" y="506" width="20" height="20" rx="4"/><rect x="502" y="506" width="20" height="20" rx="4"/></g></svg>`;

const HEAD = (title, desc, path) => `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<link rel="canonical" href="${SITE}${path}"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${SITE}${path}"/>
<style>
:root{--green:${GREEN};--green-d:#15503D;--green-l:#E7F2EE;--orange:#B85C12;--bg:#FBFAF7;--surface:#fff;--ink:#1A1A1A;--muted:#5B5B5B;--line:#E2DED7;}
*{box-sizing:border-box;}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.55;}
.wrap{max-width:760px;margin:0 auto;padding:0 16px;}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 0;}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:19px;color:var(--ink);text-decoration:none;}
nav a{color:var(--green);text-decoration:none;font-weight:600;margin-left:14px;font-size:15px;}
.town-hero{background:var(--green);border-radius:22px;color:#fff;padding:22px 24px 20px;margin:4px 0 14px;}
.town-hero .kicker{font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;opacity:.75;}
.town-hero h1{margin:2px 0 2px;font-size:34px;line-height:1.1;color:#fff;}
.town-hero .tag{display:flex;align-items:center;gap:6px;opacity:.92;font-size:15px;}
.get{display:inline-flex;align-items:center;gap:8px;background:#fff;color:var(--green);text-decoration:none;font-weight:800;padding:10px 20px;border-radius:999px;margin-top:14px;font-size:15px;}
.day-h{display:flex;align-items:baseline;justify-content:space-between;margin:22px 2px 8px;}
.day-h b{font-size:20px;}
.day-h span{color:var(--muted);font-size:14px;}
.ev{display:flex;gap:14px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:14px;margin:10px 0;box-shadow:0 3px 8px rgba(0,0,0,.04);}
.chip{flex:0 0 56px;border-radius:12px;overflow:hidden;text-align:center;align-self:flex-start;}
.chip .dow{color:#fff;font-size:10px;font-weight:800;letter-spacing:1px;padding:3px 0;}
.chip .day{font-size:22px;font-weight:800;line-height:1.05;padding-top:5px;}
.chip .mon{font-size:11px;font-weight:700;padding-bottom:6px;}
.body{min-width:0;flex:1;}
.pill{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;padding:3px 10px;border-radius:999px;margin-bottom:5px;}
.ev h3{margin:0 0 5px;font-size:18px;line-height:1.25;}
.meta{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:14px;margin:2px 0;}
.meta svg{flex:0 0 auto;opacity:.75;}
.region-h{font-size:13px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin:26px 2px 8px;}
.town{display:flex;align-items:center;justify-content:space-between;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px;text-decoration:none;color:var(--ink);margin:8px 0;}
.town b{display:block;font-size:17px;}
.town .tg{color:var(--muted);font-size:13.5px;}
.town .n{color:var(--muted);font-size:14px;white-space:nowrap;display:flex;align-items:center;gap:8px;}
.town .n:after{content:"›";color:var(--green);font-size:20px;font-weight:700;}
.banner{background:var(--green);color:#fff;border-radius:20px;padding:26px;text-align:center;margin:34px 0;}
.banner h2{margin:0 0 8px;}.banner p{opacity:.9;margin:0 auto 16px;max-width:480px;}.banner .get{background:#fff;color:var(--green);margin-top:0;}
.empty{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:28px;text-align:center;color:var(--muted);}
footer{border-top:1px solid var(--line);padding:22px 0;color:var(--muted);font-size:14px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;}
footer a{color:var(--green);text-decoration:none;}
@media(max-width:480px){.town-hero h1{font-size:28px;}.ev{padding:12px;}}
</style></head><body><div class="wrap">
<header><a class="brand" href="/">${LOGO_SVG} Local Loop</a>
<nav><a href="/events/">All towns</a><a href="/advertise.html">For businesses</a></nav></header>`;

const FOOT = `<div class="banner"><h2>Get the free app</h2>
<p>Save events, get directions, add to your calendar, and see garage sales &amp; food trucks too. All across Northwest Ohio, free.</p>
<a class="get" href="${APP_STORE_URL}">Download Local Loop</a></div>
<footer><div>© 2026 Local Loop · Northwest Ohio</div>
<div><a href="/">Home</a> · <a href="/advertise.html">Advertise</a> · <a href="/privacy.html">Privacy</a></div></footer>
</div></body></html>`;

function eventCard(e) {
  const color = CATEGORY[e.category] || GREEN;
  const tint = color + '15';
  const p = etParts(e.start_at);
  const venue = [e.venue, e.address].filter(Boolean)[0] || '';
  return `<div class="ev">
<div class="chip" style="background:${tint}"><div class="dow" style="background:${color}">${esc(p.dow.toUpperCase())}</div><div class="day" style="color:${color}">${esc(p.day)}</div><div class="mon" style="color:${color}">${esc(p.mon)}</div></div>
<div class="body"><span class="pill" style="color:${color};background:${tint}">${esc(e.category || 'Community')}</span>
<h3>${esc(e.title)}</h3>
<div class="meta">${CLOCK_SVG}<span>${esc(timeRange(e))}</span></div>
${venue ? `<div class="meta">${PIN_SVG}<span>${esc(venue)}</span></div>` : ''}</div></div>`;
}

function eventLd(e, cityName) {
  const loc = [e.venue, e.address].filter(Boolean).join(', ');
  return {
    '@context': 'https://schema.org', '@type': 'Event',
    name: e.title,
    startDate: e.start_at,
    ...(e.end_at ? { endDate: e.end_at } : {}),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: e.venue || cityName, address: loc || `${cityName}, OH` },
    ...(e.description ? { description: e.description.slice(0, 300) } : {}),
    ...(e.host ? { organizer: { '@type': 'Organization', name: e.host } } : {}),
  };
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  mkdirSync(OUT, { recursive: true });

  const nowIso = new Date().toISOString();
  const cutoff = new Date(Date.now() + HORIZON_DAYS * 86400000).toISOString();
  const todayKey = etDayKey(nowIso);
  const tomorrowKey = etDayKey(new Date(Date.now() + 86400000).toISOString());

  const counts = {};
  let grandTotal = 0;

  for (const c of APP_CITIES) {
    const { id, name, tagline } = c;
    const { data, error } = await sb
      .from('events')
      .select('title,start_at,end_at,venue,address,host,description,category')
      .eq('city_id', id).eq('status', 'approved')
      .gte('start_at', nowIso).lte('start_at', cutoff)
      .order('start_at', { ascending: true })
      .limit(300); // full 45-day horizon; stays under PostgREST's 1000 cap
    if (error) { console.error(`  ! ${id}: ${error.message}`); continue; }
    const events = data || [];
    counts[id] = events.length;
    grandTotal += events.length;

    // Group by Eastern calendar day, app-style.
    const groups = [];
    for (const e of events) {
      const k = etDayKey(e.start_at);
      const g = groups[groups.length - 1];
      if (g && g.key === k) g.items.push(e);
      else groups.push({ key: k, items: [e] });
    }
    const body = events.length
      ? groups.map((g) => `<div class="day-h"><b>${esc(dayLabel(g.key, todayKey, tomorrowKey, g.items[0].start_at))}</b><span>${g.items.length} event${g.items.length === 1 ? '' : 's'}</span></div>
${g.items.map(eventCard).join('\n')}`).join('\n')
      : `<div class="empty">No upcoming events listed yet. Check back soon, or add one free in the app.</div>`;

    const title = `Things to Do in ${name}, Ohio — Upcoming Events | Local Loop`;
    const desc = `${events.length} upcoming events in ${name}, OH — concerts, library programs, markets, festivals and more. Find local events with the free Local Loop app.`;
    const ld = events.map((e) => eventLd(e, name));

    const html = `${HEAD(title, desc, `/events/${id}.html`)}
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<section class="town-hero"><div class="kicker">Things to do in</div>
<h1>${esc(name)}, OH</h1>
${tagline ? `<div class="tag">${PIN_SVG}<span>${esc(tagline)}</span></div>` : ''}
<a class="get" href="${APP_STORE_URL}">Get the free app</a></section>
${body}
${FOOT}`;
    writeFileSync(join(OUT, `${id}.html`), html);
    console.log(`  ${name}: ${events.length} events`);
  }

  // Hub page — towns grouped by region and alphabetized, like the app's picker.
  const regionSections = REGION_ORDER.map((region) => {
    const rows = APP_CITIES
      .filter((c) => (c.region || REGION_ORDER[0]) === region)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `<a class="town" href="/events/${c.id}.html"><span><b>${esc(c.name)}, OH</b><span class="tg">${esc(c.tagline || '')}</span></span><span class="n">${counts[c.id] || 0} events</span></a>`)
      .join('\n');
    return `<div class="region-h">${esc(region)}</div>\n${rows}`;
  }).join('\n');

  const hubTitle = 'Local Events in Northwest Ohio — Findlay, Lima, Tiffin & more | Local Loop';
  const hubDesc = `Browse ${grandTotal} upcoming events across ${APP_CITIES.length} Northwest and Central Ohio towns. Concerts, markets, library programs, festivals and more — free with the Local Loop app.`;
  const hub = `${HEAD(hubTitle, hubDesc, '/events/')}
<section class="town-hero"><div class="kicker">Local events across</div>
<h1>Northwest Ohio</h1>
<div class="tag">${PIN_SVG}<span>${grandTotal} upcoming events in ${APP_CITIES.length} towns</span></div>
<a class="get" href="${APP_STORE_URL}">Get the free app</a></section>
${regionSections}
${FOOT}`;
  writeFileSync(join(OUT, 'index.html'), hub);

  // sitemap.xml + robots.txt at the site root so Google can crawl everything.
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    `${SITE}/`, `${SITE}/events/`, `${SITE}/advertise.html`, `${SITE}/privacy.html`,
    ...APP_CITIES.map((c) => `${SITE}/events/${c.id}.html`),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>`;
  const siteRoot = join(here, '..', 'site');
  writeFileSync(join(siteRoot, 'sitemap.xml'), sitemap);
  writeFileSync(join(siteRoot, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);

  console.log(`\nDone. ${grandTotal} events across ${APP_CITIES.length} town pages + hub + sitemap → site/events/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
