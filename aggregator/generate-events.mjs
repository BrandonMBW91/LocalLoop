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

import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { CITIES as APP_CITIES, REGION_ORDER } from '../src/data/cities.js';
import { cleanText, cleanLocation, cleanDescription } from '../src/lib/text.js';
import { effectiveEndMs } from '../src/lib/eventTime.js';

loadDotEnv();

const APP_STORE_URL = 'https://apps.apple.com/app/id6780306721';
const SITE = 'https://localloop.io';
// PUBLIC Supabase publishable key — baked into the embed widget (a public web page).
// Safe by design: RLS restricts it to reads of approved content, exactly like the
// app bundle already ships it. Not a secret.
const EMBED_ANON = 'sb_publishable__7DDuHpyiU8xNr5YndfZCQ_8MuVMoRw';
const HORIZON_DAYS = 45;
const TZ = 'America/New_York'; // CI runs in UTC — all day math must be Eastern

// Mirrors src/theme/theme.js colors.category — keep in sync with the app.
const CATEGORY = {
  Music: '#6A3FB0', Family: '#1C6A9E', Food: '#9E4E0F', Sports: '#197A41',
  Arts: '#A62E6B', Community: '#1F6566', Market: '#786017', Education: '#34509E',
};
const GREEN = '#15315B'; // PATRIOTIC navy (Jul 2026 seasonal). REVERT: '#1F6F54'

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'site', 'events');
// One indexable page per event/truck/sale. High-churn + high-volume, so these
// dirs are gitignored and regenerated fresh each run (the town pages in OUT stay
// committed — a small, stable set). Wiped at the start of main() so a removed or
// expired listing never lingers as a stale page in the next atomic deploy.
const EVENT_OUT = join(here, '..', 'site', 'event');
const TRUCK_OUT = join(here, '..', 'site', 'food-truck');
const SALE_OUT = join(here, '..', 'site', 'garage-sale');
// Ship gate: the per-event/truck/sale pages only generate when SEO_ITEM_PAGES=1.
// Default OFF so committing this code is inert in the daily cron until we opt in
// (add `SEO_ITEM_PAGES: '1'` to the generate-events step in aggregate.yml, then
// run the workflow). Town pages + hub + sitemap are unaffected either way.
const EMIT_ITEM_PAGES = process.env.SEO_ITEM_PAGES === '1';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'); // ' too, so single-quoted attrs are safe
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
// All-day/time-unknown anchors (noon ET no-end, or midnight ET spanning its own
// day) must read "All day", not the literal "12 PM" — mirrors the app's
// isAllDayAnchor in src/utils/dates.js.
function isAllDayIso(e) {
  const s = etParts(e.start_at);
  if (s.time === '12 PM' && !e.end_at) return true;
  if (s.time !== '12 AM') return false;
  if (!e.end_at) return true;
  const span = new Date(e.end_at) - new Date(e.start_at);
  return span >= 23.5 * 3600e3 && span <= 24.5 * 3600e3;
}
function timeRange(e) {
  const allDay = isAllDayIso(e);
  const s = etParts(e.start_at);
  if (!e.end_at) return allDay ? 'All day' : s.time;
  const en = etParts(e.end_at);
  if (etDayKey(e.start_at) === etDayKey(e.end_at)) {
    return allDay ? 'All day' : `${s.time} - ${en.time}`;
  }
  // Multi-day: a bare start clock read like a finished single-day event.
  return `${allDay ? 'All day' : s.time} through ${en.mon} ${en.day}`;
}
// Food-truck/garage-sale dates are bare YYYY-MM-DD strings (no time/zone). Format
// at noon UTC so the calendar day never shifts, and compare as plain date strings.
function fmtDay(ymd) {
  if (!ymd) return '';
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ''; // non-date input (e.g. a timestamptz) must not crash the whole run
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return `${get('weekday')}, ${get('month')} ${get('day')}`;
}
function shiftDay(ymd, delta) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// --- shared page chrome --------------------------------------------------------
const PIN_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>`;
const CLOCK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
const LOGO_SVG = `<svg width="36" height="36" viewBox="0 0 1024 1024" aria-hidden="true"><rect width="1024" height="1024" rx="232" fill="#15315B"/><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" transform="translate(176 176) scale(28)" fill="#fff"/><rect x="468" y="376" width="16" height="34" rx="7" fill="#fff"/><rect x="540" y="376" width="16" height="34" rx="7" fill="#fff"/><rect x="432" y="392" width="160" height="150" rx="18" fill="#B22234"/><rect x="448" y="452" width="128" height="8" fill="#fff"/><g fill="#fff"><rect x="462" y="474" width="20" height="20" rx="4"/><rect x="502" y="474" width="20" height="20" rx="4"/><rect x="542" y="474" width="20" height="20" rx="4"/><rect x="462" y="506" width="20" height="20" rx="4"/><rect x="502" y="506" width="20" height="20" rx="4"/></g></svg>`;

// Inline SVG favicon (navy tile + white location pin) so tabs and Google results
// carry the brand instead of a blank globe. Single-quoted SVG with %23 for the
// hex hash keeps it valid as a bare data URI in every modern browser.
const FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='24' fill='%2315315B'/><path d='M50 20c-11 0-20 9-20 20 0 15 20 35 20 35s20-20 20-35c0-11-9-20-20-20zm0 28a8 8 0 110-16 8 8 0 010 16z' fill='white'/></svg>";

// og:image matters more on these pages than anywhere else on the site: the FB routine
// posts town links into community groups 3x/week, and with no image Facebook renders
// them as a bare grey link, the lowest-engagement unit on the main distribution
// channel. Mirrors what scripts/build-web.mjs already sets for the homepage. The width
// and height are required: FB will not render a card without them.
//
// Keep prose like this OUTSIDE the template literal below. A comment written inside it
// is EMITTED, and this one shipped onto all 134 public town pages before it was caught.
const HEAD = (title, desc, path, noindex = false) => `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="icon" href="${FAVICON}"/>
<meta name="theme-color" content="#FBF8F1" media="(prefers-color-scheme: light)"/>
<meta name="theme-color" content="#0F1729" media="(prefers-color-scheme: dark)"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>${noindex ? '\n<meta name="robots" content="noindex,follow"/>' : ''}
<link rel="canonical" href="${SITE}${esc(path)}"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${SITE}${esc(path)}"/>
<meta property="og:image" content="${SITE}/og-image.png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:image:type" content="image/png"/>
<meta property="og:image:alt" content="Local Loop — everything happening in your town"/>
<meta property="og:site_name" content="Local Loop"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:image" content="${SITE}/og-image.png"/>
<style>
:root{--green:${GREEN};--green-d:#0E2444;--green-l:#E8EDF5;--orange:#B22234;--bg:#FBF8F1;--surface:#fff;--ink:#1A1A1A;--muted:#5B5B5B;--line:#E4DED4;}
*{box-sizing:border-box;}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.55;}
.wrap{max-width:760px;margin:0 auto;padding:0 16px;}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 0;}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:19px;color:var(--ink);text-decoration:none;}
nav a{color:var(--green);text-decoration:none;font-weight:600;margin-left:14px;font-size:15px;}
.town-hero{background:var(--green);border-radius:22px;color:#fff;padding:22px 24px 20px;margin:4px 0 14px;}
.town-hero .kicker{font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;opacity:.75;}
.town-hero h1{margin:2px 0 2px;font-size:34px;line-height:1.1;color:#fff;}
.town-hero .tag{display:flex;align-items:center;gap:6px;opacity:.92;font-size:15px;}
.get{display:inline-flex;align-items:center;gap:8px;background:var(--orange);color:#fff;text-decoration:none;font-weight:800;padding:10px 20px;border-radius:999px;margin-top:14px;font-size:15px;}
.day-h{display:flex;align-items:baseline;justify-content:space-between;margin:22px 2px 8px;}
.day-h b{font-size:20px;}
.day-h span{color:var(--muted);font-size:14px;}
.ev{display:flex;gap:14px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:14px;margin:10px 0;box-shadow:0 3px 8px rgba(0,0,0,.04);text-decoration:none;color:inherit;transition:box-shadow .15s ease,transform .15s ease;}
.ev:hover{box-shadow:0 7px 18px rgba(0,0,0,.10);transform:translateY(-1px);}
.ev .go{flex:0 0 auto;margin-left:auto;align-self:center;color:var(--green);font-size:26px;font-weight:700;line-height:1;padding-left:4px;}
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
.region-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:var(--green);color:#fff;border-radius:16px;padding:15px 20px;margin:32px 0 12px;}
.region-banner .rb-name{font-size:22px;font-weight:800;letter-spacing:-.01em;}
.region-banner .rb-sub{font-size:13.5px;opacity:.9;font-weight:600;}
.town{display:flex;align-items:center;justify-content:space-between;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px;text-decoration:none;color:var(--ink);margin:8px 0;}
.town b{display:block;font-size:17px;}
.town .tg{color:var(--muted);font-size:13.5px;}
.town .n{color:var(--muted);font-size:14px;white-space:nowrap;display:flex;align-items:center;gap:8px;}
.town .n:after{content:"›";color:var(--green);font-size:20px;font-weight:700;}
.banner{background:var(--green);color:#fff;border-radius:20px;padding:26px;text-align:center;margin:34px 0;}
.banner h2{margin:0 0 8px;}.banner p{opacity:.9;margin:0 auto 16px;max-width:480px;}.banner .get{margin-top:0;}
.empty{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:28px;text-align:center;color:var(--muted);}
footer{border-top:1px solid var(--line);padding:22px 0;color:var(--muted);font-size:14px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;}
footer a{color:var(--green);text-decoration:none;}
@media(max-width:480px){.town-hero h1{font-size:28px;}.ev{padding:12px;}}
/* Dark mode: mirror the app's dark palette. --green/--orange stay saturated
   (they carry white text on the hero/buttons and read on both grounds); only
   the page ground, surfaces, text, and borders invert. */
@media(prefers-color-scheme:dark){
:root{--green-l:#1C2A44;--bg:#0F1729;--surface:#182238;--ink:#E8ECF4;--muted:#98A4BA;--line:#2A3650;}
.ev{box-shadow:0 3px 8px rgba(0,0,0,.35);}
.ev:hover{box-shadow:0 7px 18px rgba(0,0,0,.55);}
}
</style></head><body><div class="wrap">
<header><a class="brand" href="/">${LOGO_SVG} Local Loop</a>
<nav><a href="/events/">All towns</a><a href="/advertise.html">For businesses</a></nav></header>`;

const FOOT = `<div class="banner"><h2>Get the free app</h2>
<p>Save events, get directions, add to your calendar, and see garage sales &amp; food trucks too. All across Ohio, free.</p>
<a class="get" href="/open.html">Download Local Loop</a></div>
<footer><div>© 2026 Local Loop · Serving all five regions of Ohio</div>
<div><a href="/">Home</a> · <a href="/advertise.html">Advertise</a> · <a href="/privacy.html">Privacy</a></div></footer>
<script>
/* Keep this static page current: hide events once they're over (by the viewer's
   clock), update each day's count, hide emptied days, note when today is done. */
(function(){
  function refresh(){
    var now=Date.now(), anyVisible=false;
    document.querySelectorAll('section.day').forEach(function(sec){
      var visible=0;
      sec.querySelectorAll('.ev').forEach(function(el){
        var end=Number(el.getAttribute('data-end'))||0;
        var over=end&&end<now; el.style.display=over?'none':''; if(!over)visible++;
      });
      sec.style.display=visible?'':'none';
      var c=sec.querySelector('.cnt'); if(c)c.textContent=visible+' event'+(visible===1?'':'s');
      if(visible)anyVisible=true;
    });
    var none=document.getElementById('noneLeft'); if(none)none.style.display=anyVisible?'none':'';
  }
  refresh(); setInterval(refresh,60000);
})();
</script>
</div></body></html>`;

function eventCard(e) {
  const color = CATEGORY[e.category] || GREEN;
  const tint = color + '15';
  const p = etParts(e.start_at);
  const venue = cleanLocation([e.venue, e.address].filter(Boolean)[0] || '');
  const title = cleanText(e.title) || 'Untitled event';
  const href = e.id ? `/event/${e.id}` : '/open.html';
  return `<a class="ev" data-end="${effectiveEndMs(e.start_at, e.end_at, e.title, e.category)}" href="${esc(href)}">
<div class="chip" style="background:${tint}"><div class="dow" style="background:${color}">${esc(p.dow.toUpperCase())}</div><div class="day" style="color:${color}">${esc(p.day)}</div><div class="mon" style="color:${color}">${esc(p.mon)}</div></div>
<div class="body"><span class="pill" style="color:${color};background:${tint}">${esc(e.category || 'Community')}</span>
<h3>${esc(title)}</h3>
<div class="meta">${CLOCK_SVG}<span>${esc(timeRange(e))}</span></div>
${venue ? `<div class="meta">${PIN_SVG}<span>${esc(venue)}</span></div>` : ''}</div>
<span class="go" aria-hidden="true">›</span></a>`;
}

function eventLd(e, cityName) {
  const venue = cleanLocation(e.venue);
  const address = cleanLocation(e.address);
  // deriveVenue often sets venue === address; avoid "Fort Meigs, Fort Meigs".
  let loc;
  if (!venue) loc = address;
  else if (!address || address === venue || address.includes(venue)) loc = address || venue;
  else loc = `${venue}, ${address}`;
  const description = cleanDescription(e.description);
  const host = cleanText(e.host);
  return {
    '@context': 'https://schema.org', '@type': 'Event',
    name: cleanText(e.title),
    startDate: e.start_at,
    ...(e.end_at ? { endDate: e.end_at } : {}),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: venue || cityName, address: loc || `${cityName}, OH` },
    ...(description ? { description: description.slice(0, 300) } : {}),
    ...(host ? { organizer: { '@type': 'Organization', name: host } } : {}),
  };
}

// One indexable page per event: real crawlable content + single-Event JSON-LD so
// Google can surface it, and a working share target — a shared /event/{id} link now
// shows the event instead of the open.html wall. Missing/expired ids still fall to
// open.html via the non-forced /event/* rewrite (Netlify serves an existing static
// file before a non-forced rewrite).
function eventPage(e, cityName, cityId) {
  const p = etParts(e.start_at);
  const title = cleanText(e.title) || 'Event';
  const venue = cleanLocation([e.venue, e.address].filter(Boolean)[0] || '');
  const description = cleanDescription(e.description);
  const cat = e.category || 'Community';
  const when = `${p.dow}, ${p.mon} ${p.day} · ${timeRange(e)}`;
  const metaDesc = `${title} in ${cityName}, OH${venue ? ` at ${venue}` : ''} — ${when}. ${description ? description.slice(0, 130) : 'See details and get directions free in the Local Loop app.'}`.replace(/\s+/g, ' ').slice(0, 300);
  const ld = eventLd(e, cityName);
  return `${HEAD(`${title} — ${cityName}, OH | Local Loop`, metaDesc, `/event/${e.id}`)}
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<article>
<section class="town-hero"><div class="kicker">${esc(cat)} · ${esc(cityName)}, OH</div>
<h1>${esc(title)}</h1>
<div class="tag">${CLOCK_SVG}<span>${esc(when)}</span></div>
${venue ? `<div class="tag">${PIN_SVG}<span>${esc(venue)}</span></div>` : ''}
<a class="get" href="/open.html">Get directions in the app</a></section>
${description ? `<p style="font-size:16px;line-height:1.65;margin:16px 4px 22px;white-space:pre-line;">${esc(description.slice(0, 1500))}</p>` : ''}
<a class="town" href="/events/${cityId}.html"><span><b>See everything in ${esc(cityName)}, OH</b><span class="tg">More events, garage sales &amp; food trucks</span></span><span class="n">Browse</span></a>
</article>
${FOOT}`;
}

// Lighter share page for a food truck stop or garage sale — reclaims a shared link
// (was a dead open.html wall) with real content + an app CTA. No rich JSON-LD (these
// aren't schema.org Events we want indexed the same way); noindex,follow keeps the
// crawl budget on the event pages while still letting the link render when shared.
function sharePage(kind, item, cityName, cityId) {
  const label = kind === 'food-truck' ? 'Food truck' : 'Garage sale';
  const title = cleanText(item.title) || label;
  const venue = cleanLocation(item.venue || '');
  const description = cleanDescription(item.description);
  const when = item.when || '';
  const metaDesc = `${title} in ${cityName}, OH${venue ? ` at ${venue}` : ''}${when ? ` — ${when}` : ''}. See it free in the Local Loop app.`.replace(/\s+/g, ' ').slice(0, 300);
  return `${HEAD(`${title} — ${label} in ${cityName}, OH | Local Loop`, metaDesc, `/${kind}/${item.id}`, true)}
<article>
<section class="town-hero"><div class="kicker">${esc(label)} · ${esc(cityName)}, OH</div>
<h1>${esc(title)}</h1>
${when ? `<div class="tag">${CLOCK_SVG}<span>${esc(when)}</span></div>` : ''}
${venue ? `<div class="tag">${PIN_SVG}<span>${esc(venue)}</span></div>` : ''}
<a class="get" href="/open.html">Open in the app</a></section>
${description ? `<p style="font-size:16px;line-height:1.65;margin:16px 4px 22px;white-space:pre-line;">${esc(description.slice(0, 1200))}</p>` : ''}
<a class="town" href="/events/${cityId}.html"><span><b>See everything in ${esc(cityName)}, OH</b><span class="tg">Events, garage sales &amp; food trucks</span></span><span class="n">Browse</span></a>
</article>
${FOOT}`;
}

// Partner-facing landing: pick a town, copy the iframe snippet, see a live preview.
// The page chambers/CVBs/libraries are pointed to when adopting the embed widget.
function partnersPage(optionsHtml) {
  return `${HEAD('Add Local Loop events to your website | Local Loop', 'Embed your town’s upcoming events on your own site, free. One line of HTML for chambers of commerce, visitor bureaus, libraries and town sites — always current.', '/partners.html')}
<section class="town-hero"><div class="kicker">For chambers, CVBs, libraries &amp; town sites</div>
<h1>Put your town’s events on your site</h1>
<div class="tag">${PIN_SVG}<span>Free, always current, one line of HTML</span></div></section>
<p style="font-size:16px;line-height:1.6;margin:14px 4px;">Pick your town, copy the snippet, and paste it into your page. The widget updates itself as new events are added &mdash; nothing to maintain on your end.</p>
<div style="background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px;margin:12px 0;">
  <label style="font-weight:700;font-size:14px;display:block;margin-bottom:8px;">Your town
    <select id="town" style="font-size:15px;padding:8px 10px;border-radius:10px;border:1px solid var(--line);margin-left:6px;">${optionsHtml}</select>
  </label>
  <textarea id="snippet" readonly rows="3" aria-label="Embed snippet" style="width:100%;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--green-l);color:var(--ink);resize:vertical;"></textarea>
  <button id="copy" class="get" style="border:0;cursor:pointer;margin-top:10px;">Copy snippet</button>
</div>
<div style="margin:14px 0 8px;font-weight:800;color:var(--muted);font-size:13px;letter-spacing:.5px;text-transform:uppercase;">Live preview</div>
<iframe id="preview" src="https://localloop.io/embed.html?town=findlay" style="width:100%;max-width:420px;height:560px;border:0" loading="lazy" title="Local Loop events preview"></iframe>
<script>
(function(){
  var sel=document.getElementById('town'),ta=document.getElementById('snippet'),pv=document.getElementById('preview'),btn=document.getElementById('copy');
  function snip(t){return '<iframe src="https://localloop.io/embed.html?town='+t+'" style="width:100%;max-width:420px;height:560px;border:0" loading="lazy" title="Upcoming events"></iframe>';}
  function upd(){var t=sel.value;ta.value=snip(t);pv.src='https://localloop.io/embed.html?town='+t;}
  sel.addEventListener('change',upd);
  btn.addEventListener('click',function(){ta.select();try{document.execCommand('copy');}catch(e){}btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy snippet';},1500);});
  upd();
})();
</script>
${FOOT}`;
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  mkdirSync(OUT, { recursive: true });
  // Fresh per-item dirs each run so removed/expired listings don't linger as stale
  // pages in the next (atomic) deploy. Gated — see EMIT_ITEM_PAGES.
  if (EMIT_ITEM_PAGES) {
    for (const d of [EVENT_OUT, TRUCK_OUT, SALE_OUT]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); }
  }
  const eventUrls = [];

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const backIso = new Date(nowMs - 12 * 3600 * 1000).toISOString(); // reach back so still-running events stay
  const cutoff = new Date(nowMs + HORIZON_DAYS * 86400000).toISOString();
  const todayKey = etDayKey(nowIso);
  const tomorrowKey = etDayKey(new Date(Date.now() + 86400000).toISOString());

  const counts = {};
  let grandTotal = 0;

  for (const c of APP_CITIES) {
    const { id, name, tagline } = c;
    // Paginate past PostgREST's 1000-row cap so a high-volume town (Akron is ~900
    // and climbing) never silently drops its later days from the page + sitemap.
    // Secondary order on id makes the page boundaries deterministic across ties.
    let data = [];
    let error = null;
    for (let from = 0; ; from += 1000) {
      const page = await sb
        .from('events')
        .select('id,title,start_at,end_at,venue,address,host,description,category')
        .eq('city_id', id).eq('status', 'approved')
        // Started recently OR still running (a festival on day 3 must stay on
        // the page); the lte keeps the horizon bounded either way.
        .or(`start_at.gte.${backIso},end_at.gte.${nowIso}`).lte('start_at', cutoff)
        .order('start_at', { ascending: true }).order('id', { ascending: true })
        .range(from, from + 999);
      if (page.error) { error = page.error; break; }
      data = data.concat(page.data || []);
      if ((page.data || []).length < 1000) break; // last page reached
    }
    if (error) { console.error(`  ! ${id}: ${error.message}`); continue; }
    // Render-time dedup guard: collapse same title+venue on the same ET day,
    // so a page is never wrong even if a duplicate slips past ingest dedup.
    const seen = new Set();
    const events = (data || [])
      // Drop events already over (real end, or an estimate) so a morning event
      // isn't still shown at night. Ongoing events stay. Client JS trims further live.
      .filter((e) => effectiveEndMs(e.start_at, e.end_at, e.title, e.category) >= nowMs)
      .filter((e) => {
        const k = `${(e.title || '').trim().toLowerCase()}|${(e.venue || '').trim().toLowerCase()}|${etDayKey(e.start_at)}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    counts[id] = events.length;
    grandTotal += events.length;

    // Group by Eastern calendar day, app-style. A still-running event whose
    // start day already passed files under TODAY (it is happening today), after
    // today's fresh starts — not under a stale week-old date heading.
    const displayKey = (e) => {
      const k = etDayKey(e.start_at);
      return k < todayKey ? todayKey : k;
    };
    events.sort((a, b) => {
      const ka = displayKey(a), kb = displayKey(b);
      if (ka !== kb) return ka < kb ? -1 : 1;
      const ca = etDayKey(a.start_at) < todayKey ? 1 : 0; // carry-overs after fresh starts
      const cb = etDayKey(b.start_at) < todayKey ? 1 : 0;
      if (ca !== cb) return ca - cb;
      return a.start_at < b.start_at ? -1 : a.start_at > b.start_at ? 1 : 0;
    });
    const groups = [];
    for (const e of events) {
      const k = displayKey(e);
      const g = groups[groups.length - 1];
      if (g && g.key === k) g.items.push(e);
      else groups.push({ key: k, items: [e] });
    }
    const body = (events.length
      ? groups.map((g) => `<section class="day"><div class="day-h"><b>${esc(dayLabel(g.key, todayKey, tomorrowKey, g.items[0].start_at))}</b><span class="cnt">${g.items.length} event${g.items.length === 1 ? '' : 's'}</span></div>
${g.items.map(eventCard).join('\n')}</section>`).join('\n')
      : `<div class="empty">No upcoming events listed yet. Check back soon, or add one free in the app.</div>`)
      + `<div class="empty" id="noneLeft" style="display:none">That's a wrap for today. Check back tomorrow, or open the app for garage sales and food trucks too.</div>`;

    const title = `Things to Do in ${name}, Ohio: Upcoming Events | Local Loop`;
    const desc = `${events.length} upcoming events in ${name}, OH. Concerts, library programs, markets, festivals and more, free with the Local Loop app.`;
    const ld = events.map((e) => eventLd(e, name));

    const html = `${HEAD(title, desc, `/events/${id}.html`, events.length === 0)}
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<section class="town-hero"><div class="kicker">Things to do in</div>
<h1>${esc(name)}, OH</h1>
${tagline ? `<div class="tag">${PIN_SVG}<span>${esc(tagline)}</span></div>` : ''}
<a class="get" href="/open.html">Get the free app</a></section>
${body}
${FOOT}`;
    writeFileSync(join(OUT, `${id}.html`), html);
    // One indexable page per event (also the share + town-card-link target).
    if (EMIT_ITEM_PAGES) for (const e of events) {
      if (!e.id) continue;
      writeFileSync(join(EVENT_OUT, `${e.id}.html`), eventPage(e, name, id));
      eventUrls.push(`${SITE}/event/${e.id}`);
    }
    console.log(`  ${name}: ${events.length} events`);
  }

  // Share pages for food trucks + garage sales — reclaims a shared link (was a dead
  // open.html wall) with real content. noindex,follow (set in sharePage) keeps the
  // crawl budget on events. Volume is tiny, so no cap needed.
  const cityById = new Map(APP_CITIES.map((c) => [c.id, c.name]));
  let truckPages = 0, salePages = 0;
  if (EMIT_ITEM_PAGES) {
    const { data: trucks } = await sb.from('food_trucks')
      .select('id,city_id,name,date,start_time,end_time,location_name,address,note')
      .eq('status', 'approved').gte('date', shiftDay(todayKey, -1));
    for (const t of trucks || []) {
      const name = cityById.get(t.city_id);
      if (!name || !t.id) continue;
      const when = [fmtDay(t.date), [t.start_time, t.end_time].filter(Boolean).join(' - ')].filter(Boolean).join(' · ');
      const item = { id: t.id, title: t.name, when, venue: t.location_name || t.address, description: t.note };
      writeFileSync(join(TRUCK_OUT, `${t.id}.html`), sharePage('food-truck', item, name, t.city_id));
      truckPages++;
    }
    const { data: sales } = await sb.from('garage_sales')
      .select('id,city_id,title,start_date,end_date,daily_start,daily_end,address,neighborhood,note')
      .eq('status', 'approved').gte('end_date', todayKey);
    for (const s of sales || []) {
      const name = cityById.get(s.city_id);
      if (!name || !s.id) continue;
      const days = s.end_date && s.end_date !== s.start_date ? `${fmtDay(s.start_date)} - ${fmtDay(s.end_date)}` : fmtDay(s.start_date);
      const when = [days, [s.daily_start, s.daily_end].filter(Boolean).join(' - ')].filter(Boolean).join(' · ');
      const item = { id: s.id, title: s.title, when, venue: s.address || s.neighborhood, description: s.note };
      writeFileSync(join(SALE_OUT, `${s.id}.html`), sharePage('garage-sale', item, name, s.city_id));
      salePages++;
    }
    // Embeddable town widget — one runtime-data-driven file serves every town via
    // ?town=. Partners (chambers/CVBs) iframe it; it fetches current events itself.
    const embedTpl = readFileSync(join(here, 'embed.template.html'), 'utf8')
      .replace(/__SUPABASE_URL__/g, SUPABASE_URL)
      .replace(/__SUPABASE_ANON__/g, EMBED_ANON);
    writeFileSync(join(here, '..', 'site', 'embed.html'), embedTpl);
    // Partner landing (copy-paste snippet + live preview) — towns with events only.
    const partnerOpts = APP_CITIES.filter((c) => (counts[c.id] || 0) > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `<option value="${c.id}"${c.id === 'findlay' ? ' selected' : ''}>${esc(c.name)}, OH</option>`)
      .join('');
    writeFileSync(join(here, '..', 'site', 'partners.html'), partnersPage(partnerOpts));
    // Self-serve advertiser portal (the "manage your ad" link in the ad-is-live email).
    const manageTpl = readFileSync(join(here, 'manage-ad.template.html'), 'utf8')
      .replace(/__SUPABASE_URL__/g, SUPABASE_URL)
      .replace(/__SUPABASE_ANON__/g, EMBED_ANON);
    writeFileSync(join(here, '..', 'site', 'manage-ad.html'), manageTpl);
  }

  // Hub page — towns grouped by region and alphabetized, like the app's picker.
  const regionSections = REGION_ORDER.map((region) => {
    const towns = APP_CITIES
      .filter((c) => (c.region || REGION_ORDER[0]) === region)
      .sort((a, b) => a.name.localeCompare(b.name));
    const rEvents = towns.reduce((s, c) => s + (counts[c.id] || 0), 0);
    const rows = towns
      .map((c) => `<a class="town" href="/events/${c.id}.html"><span><b>${esc(c.name)}, OH</b><span class="tg">${esc(c.tagline || '')}</span></span><span class="n">${counts[c.id] || 0} events</span></a>`)
      .join('\n');
    return `<div class="region-banner"><span class="rb-name">${esc(region)}</span><span class="rb-sub">${towns.length} towns · ${rEvents.toLocaleString()} events</span></div>\n${rows}`;
  }).join('\n');

  // Towns with live content — the honest "100+ and growing" number, not the catalog.
  const activeCount = Object.values(counts).filter((n) => n > 0).length;
  const hubTitle = 'Local Events Across Ohio: Findlay, Toledo, Akron, Canton and more | Local Loop';
  const hubDesc = `Browse ${grandTotal} upcoming events across ${activeCount} Ohio towns. Concerts, markets, library programs, festivals and more, free with the Local Loop app.`;
  const hub = `${HEAD(hubTitle, hubDesc, '/events/')}
<section class="town-hero"><div class="kicker">Local events across</div>
<h1>Local Events Across Ohio</h1>
<div class="tag">${PIN_SVG}<span>${grandTotal} upcoming events across ${activeCount} Ohio towns</span></div>
<a class="get" href="/open.html">Get the free app</a></section>
${regionSections}
${FOOT}`;
  writeFileSync(join(OUT, 'index.html'), hub);

  // sitemap.xml + robots.txt at the site root so Google can crawl everything.
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    `${SITE}/`, `${SITE}/events/`, `${SITE}/advertise.html`, `${SITE}/privacy.html`,
    // Only list town pages that actually have events — don't ask Google to index empties.
    ...APP_CITIES.filter((c) => (counts[c.id] || 0) > 0).map((c) => `${SITE}/events/${c.id}.html`),
    // Every upcoming event page (the big indexable-surface win). Well under the
    // 50k-URL sitemap cap at current volume; split into a sitemap index if it grows.
    ...eventUrls,
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>`;
  const siteRoot = join(here, '..', 'site');
  writeFileSync(join(siteRoot, 'sitemap.xml'), sitemap);
  // Crawlers must stay on the STATIC pages (/e/, /events/) and off the JS app
  // routes. Those routes duplicate the static pages AND every render booted the
  // app: a JS-rendering crawler followed /e/<id>.html's "Open in Local Loop" link
  // into /event/<id>, and since a bot keeps no localStorage it minted a NEW
  // anonymous device on every hit — 125 fake "active users" and 144 fake event
  // views by 2026-07-16, in the very metric that prices ads. Blocking them also
  // removes the duplicate-content problem. '/' stays crawlable.
  const DISALLOW = ['/event/', '/garage-sale/', '/food-truck/', '/map', '/calendar', '/saved',
    '/sign-in', '/ads', '/metrics', '/moderate', '/city', '/welcome', '/interests',
    '/claim', '/route', '/editor-pick', '/manage-deals', '/promote'];
  writeFileSync(
    join(siteRoot, 'robots.txt'),
    `User-agent: *\nAllow: /\n${DISALLOW.map((d) => `Disallow: ${d}`).join('\n')}\nSitemap: ${SITE}/sitemap.xml\n`,
  );

  console.log(`\nDone. ${grandTotal} events across ${APP_CITIES.length} town pages + ${eventUrls.length} event pages + ${truckPages} food-truck + ${salePages} garage-sale share pages + hub + sitemap.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
