// Static SEO page generator for Local Loop.
// Pulls upcoming approved events from Supabase and writes branded, Google-
// indexable HTML into site/events/ — a hub page plus one page per town, each
// with schema.org Event structured data (rich results) and an app-download CTA.
// This drives organic discovery: people searching "things to do in Findlay"
// land on these pages, then install the app.
//
//   node web/generate-events.mjs
//
// Env (from aggregator/.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from '../aggregator/env.mjs';
import { CITIES as APP_CITIES } from '../src/data/cities.js';

loadDotEnv();

const APP_STORE_URL = 'https://apps.apple.com/app/id6780306721';
const SITE = 'https://localloop.io';
const HORIZON_DAYS = 45;

// Single source of truth for towns — same list the app uses, so new towns get
// SEO pages automatically.
const CITIES = APP_CITIES.map((c) => [c.id, c.name]);
const NAME = Object.fromEntries(CITIES);

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'site', 'events');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function human(iso) {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const time = m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`;
  return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()} · ${time}`;
}

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
:root{--green:#1F6F54;--orange:#B85C12;--bg:#FBFAF7;--surface:#fff;--ink:#1A1A1A;--muted:#5B5B5B;--line:#E2DED7;}
*{box-sizing:border-box;}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.6;}
.wrap{max-width:860px;margin:0 auto;padding:0 20px;}
header{display:flex;align-items:center;justify-content:space-between;padding:18px 0;}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:20px;color:var(--ink);text-decoration:none;}
nav a{color:var(--green);text-decoration:none;font-weight:600;margin-left:16px;}
h1{font-size:32px;line-height:1.2;margin:24px 0 6px;}
.sub{color:var(--muted);font-size:18px;margin:0 0 8px;}
.get{display:inline-flex;align-items:center;gap:8px;background:var(--green);color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;margin:14px 0;}
.ev{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:12px 0;}
.ev .when{color:var(--orange);font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:.5px;}
.ev h3{margin:4px 0 4px;font-size:19px;}
.ev .meta{color:var(--muted);font-size:15px;margin:0;}
.towns{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:24px 0;}
.town{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;text-decoration:none;color:var(--ink);}
.town b{display:block;font-size:17px;}.town span{color:var(--muted);font-size:14px;}
.banner{background:var(--green);color:#fff;border-radius:18px;padding:28px;text-align:center;margin:36px 0;}
.banner h2{margin:0 0 8px;}.banner p{opacity:.9;margin:0 auto 16px;max-width:480px;}.banner .get{background:#fff;color:var(--green);}
footer{border-top:1px solid var(--line);padding:24px 0;color:var(--muted);font-size:14px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;}
footer a{color:var(--green);text-decoration:none;}
@media(max-width:560px){h1{font-size:26px;}}
</style></head><body><div class="wrap">
<header><a class="brand" href="/">📅 Local Loop</a>
<nav><a href="/events/">All towns</a><a href="/advertise.html">For businesses</a></nav></header>`;

const FOOT = `<div class="banner"><h2>Get the free app</h2>
<p>Save events, get directions, add to your calendar, and see garage sales &amp; food trucks too — all across Northwest Ohio.</p>
<a class="get" href="${APP_STORE_URL}">Download Local Loop</a></div>
<footer><div>© 2026 Local Loop · Northwest Ohio</div>
<div><a href="/">Home</a> · <a href="/advertise.html">Advertise</a> · <a href="/privacy.html">Privacy</a></div></footer>
</div></body></html>`;

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

  const counts = {};
  let grandTotal = 0;

  for (const [id, name] of CITIES) {
    const { data, error } = await sb
      .from('events')
      .select('title,start_at,end_at,venue,address,host,description,category')
      .eq('city_id', id).eq('status', 'approved')
      .gte('start_at', nowIso).lte('start_at', cutoff)
      .order('start_at', { ascending: true })
      .limit(60);
    if (error) { console.error(`  ! ${id}: ${error.message}`); continue; }
    const events = data || [];
    counts[id] = events.length;
    grandTotal += events.length;

    const title = `Things to Do in ${name}, Ohio — Upcoming Events | Local Loop`;
    const desc = `${events.length} upcoming events in ${name}, OH — concerts, library programs, markets, festivals and more. Find local events with the free Local Loop app.`;
    const ld = events.map((e) => eventLd(e, name));
    const body = events.length
      ? events.map((e) => {
          const loc = [e.venue, e.address].filter(Boolean).join(' · ');
          return `<div class="ev"><div class="when">${esc(human(e.start_at))}</div>
<h3>${esc(e.title)}</h3>${loc ? `<p class="meta">${esc(loc)}</p>` : ''}</div>`;
        }).join('\n')
      : `<p class="sub">No upcoming events listed yet — check back soon, or add one in the app.</p>`;

    const html = `${HEAD(title, desc, `/events/${id}.html`)}
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<h1>Things to do in ${esc(name)}, Ohio</h1>
<p class="sub">${events.length} upcoming local event${events.length === 1 ? '' : 's'} near ${esc(name)}.</p>
<a class="get" href="${APP_STORE_URL}">Get the free app</a>
${body}
${FOOT}`;
    writeFileSync(join(OUT, `${id}.html`), html);
    console.log(`  ${name}: ${events.length} events`);
  }

  // Hub page
  const townCards = CITIES
    .slice()
    .sort((a, b) => (counts[b[0]] || 0) - (counts[a[0]] || 0))
    .map(([id, name]) => `<a class="town" href="/events/${id}.html"><b>${esc(name)}, OH</b><span>${counts[id] || 0} upcoming events</span></a>`)
    .join('\n');
  const hubTitle = 'Local Events in Northwest Ohio — Findlay, Lima, Tiffin & more | Local Loop';
  const hubDesc = `Browse ${grandTotal} upcoming events across 18 Northwest Ohio towns. Concerts, markets, library programs, festivals and more — free with the Local Loop app.`;
  const hub = `${HEAD(hubTitle, hubDesc, '/events/')}
<h1>Local events across Northwest Ohio</h1>
<p class="sub">${grandTotal} upcoming events in ${CITIES.length} towns. Pick yours:</p>
<a class="get" href="${APP_STORE_URL}">Get the free app</a>
<div class="towns">${townCards}</div>
${FOOT}`;
  writeFileSync(join(OUT, 'index.html'), hub);

  // sitemap.xml + robots.txt at the site root so Google can crawl everything.
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    `${SITE}/`, `${SITE}/events/`, `${SITE}/advertise.html`, `${SITE}/privacy.html`,
    ...CITIES.map(([id]) => `${SITE}/events/${id}.html`),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>`;
  const siteRoot = join(here, '..', 'site');
  writeFileSync(join(siteRoot, 'sitemap.xml'), sitemap);
  writeFileSync(join(siteRoot, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);

  console.log(`\nDone. ${grandTotal} events across ${CITIES.length} town pages + hub + sitemap → site/events/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
