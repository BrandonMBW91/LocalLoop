// Local Loop's weekly Facebook posting routine. Generates the right post for a
// given slot from live event data and (with --email) mails it to the owner ready
// to schedule, with a "post this at <time>" note.
//
//   node fb-routine.mjs --type=midweek_spotlight [--email]   # Tue 12 PM slot
//   node fb-routine.mjs --type=weekend_digest    [--email]   # Thu 6 PM slot (has App Store link)
//   node fb-routine.mjs --type=tonight           [--email]   # Sat 10 AM slot (falls back to a question)
//   node fb-routine.mjs --type=engagement        [--email]   # community question
//
// Family-safe: adult / profane / broken / bad-time events are hard-dropped before
// anything is written. No em-dashes, no AI-tell phrasing. The App Store link rides
// only on the weekend digest so the page never reads as spammy.
import { readFileSync, writeFileSync } from 'node:fs';
import { CITIES } from './src/data/cities.js';
import { MARQUEE, BIGDRAW, FILLER, isShouty, isUnsafe, isImplausibleTime, scrubDashes } from './aggregator/content-safety.mjs';

const DIR = new URL('.', import.meta.url);
const read = (p) => { try { return readFileSync(new URL(p, DIR), 'utf8'); } catch { return ''; } };
const env = read('.env') + '\n' + read('aggregator/.env');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const SB = g('EXPO_PUBLIC_SUPABASE_URL') || g('SUPABASE_URL');
const KEY = g('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const APP = 'https://apps.apple.com/app/id6780306721';
const TZ = 'America/New_York';
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.split('=')[1] : d; };
const TYPE = arg('type', 'weekend_digest');

// --- time / place helpers (all DST-correct via Intl) ---
const etDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const etLong = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(new Date(iso));
const etMonthDay = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'long', day: 'numeric' }).format(new Date(iso));
const etParts = (iso) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(iso));
  const get = (t) => (p.find((x) => x.type === t) || {}).value || '';
  const h24 = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date(iso)));
  return { time: `${get('hour')}:${get('minute')} ${get('dayPeriod')}`.replace(':00 ', ' '), h24 };
};
// Canonical town display names (Put-in-Bay, McArthur, St. Marys, LaRue…) so the
// naive hyphen title-case never mangles an irregular one; falls back to
// title-casing the slug for anything not in the catalog.
const CITY_NAME = Object.fromEntries(CITIES.map((c) => [c.id, c.name]));
const CITY_REGION = Object.fromEntries(CITIES.map((c) => [c.id, c.region]));
const cap = (s) => CITY_NAME[s] || (s || '').split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const joinCities = (arr) => {
  const u = [...new Set(arr)].map(cap).slice(0, 3);
  if (u.length <= 1) return u[0] || 'the area';
  if (u.length === 2) return `${u[0]} and ${u[1]}`;
  return `${u[0]}, ${u[1]}, and ${u[2]}`;
};

// --- title cleanup ---
function cleanTitle(t) {
  let s = (t || '').replace(/\s*\|\s*.*$/, '')
    .replace(/\s+[-–—]\s+[^-–—]*\b(OH|Ohio)\b.*$/i, '')
    .replace(/\s+(tickets?|presented by).*$/i, '')
    .replace(/\s+[-–—]\s+.*?\b(\d+(?:st|nd|rd|th)?\s+of\s+\d+|market date|outdoor season|week\s+\d+|day\s+\d+|session\s+\d+)\b.*$/i, '') // strip admin subtitle cruft after " - " (e.g. "3rd of 6 ... Date")
    .replace(/,\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2}\s*$/, '') // drop a trailing ", Town" that collides with city_id
    .replace(/\s{2,}/g, ' ').trim();
  if (s.length > 58) {
    s = s.slice(0, 55); const sp = s.lastIndexOf(' '); if (sp > 30) s = s.slice(0, sp);
    s = s.replace(/["'(,\s–-]+$/, '');
    if ((s.match(/"/g) || []).length % 2) s = s.replace(/\s*"(?=[^"]*$)/, ''); // drop a dangling open quote left by the cut
    s = s + '…';
  }
  return s;
}
// Venue field is often a full mailing address or a room path; keep just the place name.
function cleanVenue(v) {
  if (!v) return '';
  let s = String(v).split(',')[0].trim();          // drop street, city, state, zip, country
  s = s.split('|')[0].trim();                       // drop "| City, ST" style venue suffixes
  s = s.replace(/\s*[-–—]\s*.*$/, '');             // drop " - Meeting Room A", "- 2nd Floor"
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ').trim();   // drop "(Capacity : 75)"
  s = s.replace(/\s{2,}/g, ' ');
  if (/\bcalendars?\b|\blistings?\b|\bcvb\b|visitors bureau|chamber of commerce/i.test(s)) return ''; // a feed/org name, not a place you go
  if (s.length > 42) s = s.slice(0, 40).trim() + '…';
  return s;
}

// --- scoring + safety (shared with the weekend generator) ---
const scoreOf = (e) => {
  let s = (e.city_id === 'findlay' || e.city_id === 'toledo') ? 3 : 1;
  if (MARQUEE.test(e.title)) s += 6;
  if (BIGDRAW.test(e.title)) s += 4; // real draws outrank lesser marquee (craft club, library movie)
  if (FILLER.test(e.title)) s -= 8;
  if (isShouty(e.title)) s -= 7;
  const h = e._t.h24;
  if (h >= 10 && h <= 21) s += 3; else if (h < 7) s -= 5;
  return s;
};
const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'at', 'in', 'on', 'for', 'to', 'with', 'live', 'music', 'event', 'night', 'presents', 'featuring', 'ft', 'w']);
const sig = (t) => (t.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w)).sort().join(' ') || t.toLowerCase().replace(/[^a-z0-9]/g, '');

const enc = encodeURIComponent;
const q = async (p) => { const r = await fetch(`${SB}/rest/v1/${p}`, { headers: H }); return r.ok ? r.json() : []; };

// Broad fetch of upcoming approved events, cleaned + safety-filtered once.
async function fetchEvents(daysAhead) {
  const lo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const hi = new Date(Date.now() + daysAhead * 86400000).toISOString();
  const raw = await q(`events?status=eq.approved&start_at=gte.${enc(lo)}&start_at=lt.${enc(hi)}&select=title,category,city_id,venue,start_at&order=start_at.asc&limit=2000`);
  return raw
    .map((e) => ({ ...e, title: cleanTitle(e.title), _t: etParts(e.start_at), _d: etDay(e.start_at) }))
    .filter((e) => CITY_NAME[e.city_id]) // never post an off-catalog town (would render as a raw slug)
    .filter((e) => e.title && e.title.length >= 4)
    .filter((e) => !isUnsafe(e.title) && !isImplausibleTime(e.title, e._t.h24));
}

// Normalize for a fuzzy title/venue compare: drop possessives, plurals, and
// punctuation so "Haymakers Farmers' Market" (title) still suppresses the near-
// identical "Haymaker Farmers' Market" (venue).
const normName = (x) => (x || '').toLowerCase().replace(/['’]s\b/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(\w+?)s\b/g, '$1').replace(/\s+/g, ' ').trim();
const venuePlace = (e) => {
  const v = cleanVenue(e.venue);
  const vl = v.toLowerCase().replace(/…$/, '');
  const city = cap(e.city_id).toLowerCase();
  const nt = normName(e.title), nv = normName(vl);
  // Drop the venue when it echoes the title (fuzzily) or IS the town name — else
  // you get "Farmers Market at Farmers Market, Town".
  const redundant = !vl || (nv && (nt.includes(nv) || nv.includes(nt))) || vl === city;
  return redundant ? `in ${cap(e.city_id)}` : `at ${v}, ${cap(e.city_id)}`;
};
const timeTag = (e) => (e._t.h24 >= 8 ? ` (${e._t.time})` : '');

// --- WEEKEND DIGEST (Thu, flagship, App Store link) ---
function weekendKeys() {
  const nowKey = etDay(new Date().toISOString());
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date()));
  const toFri = dow === 6 ? -1 : (5 - dow);
  const base = new Date(nowKey + 'T12:00:00-04:00');
  return [0, 1, 2].map((i) => etDay(new Date(base.getTime() + (toFri + i) * 86400000).toISOString()));
}
async function genWeekend() {
  const wk = weekendKeys();
  const all = (await fetchEvents(9)).filter((e) => new Set(wk).has(e._d));
  const bySig = new Map();
  for (const e of all) { const s = { ...e, score: scoreOf(e) }; const k = sig(e.title); const c = bySig.get(k); if (!c || s.score > c.score) bySig.set(k, s); }
  // Cluster the whole digest to ONE region (the strongest event's) so we never
  // headline "around here" over towns 2+ hours apart. A thin coherent digest beats
  // a statewide grab-bag (the weak-check below still warns if it's too thin).
  const scored = [...bySig.values()].filter((e) => MARQUEE.test(e.title) || e.score > 0).sort((a, b) => b.score - a.score);
  const topRegion = scored.length ? CITY_REGION[scored[0].city_id] : null;
  const eligible = topRegion ? scored.filter((e) => CITY_REGION[e.city_id] === topRegion) : scored;
  const picks = [];
  const uT = {}, uC = {}, uA = {};
  // Collapse near-duplicate activity types so a digest isn't "3 boat cruises and 2
  // farmers markets" — cap each activity keyword at 2 across the whole digest.
  const activityOf = (title) => ((title || '').toLowerCase().match(/\b(cruise|farmers?.?market|market|festival|fair|concert|parade|fireworks|car show|craft|5k|tournament|comedy|theat(?:er|re)|movie|paint|trivia|food truck)\b/) || [])[1] || '';
  for (const e of eligible.sort((a, b) => b.score - a.score)) {
    if (picks.length >= 6) break;
    const act = activityOf(e.title);
    if ((uT[e.city_id] || 0) >= 2 || (uC[e.category] || 0) >= 2 || (act && (uA[act] || 0) >= 2)) continue;
    picks.push(e); uT[e.city_id] = (uT[e.city_id] || 0) + 1; uC[e.category] = (uC[e.category] || 0) + 1; if (act) uA[act] = (uA[act] || 0) + 1;
  }
  const weak = picks.length < 4 || picks.filter((e) => MARQUEE.test(e.title)).length < 2 || new Set(picks.map((e) => e.city_id)).size < 2;
  const order = ['Friday', 'Saturday', 'Sunday'];
  picks.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  const groups = order.map((d) => [d, picks.filter((e) => etLong(e.start_at) === d)]).filter(([, list]) => list.length);
  const body = groups.map(([d, list]) => `${d}\n` + list.map((e) => `• ${e.title} ${venuePlace(e)}${timeTag(e)}`).join('\n')).join('\n\n');
  const cities = joinCities(picks.map((e) => e.city_id));
  // Data from the page's own posts: a clickable external link tanked reach to 10,
  // while a plain-text "search Local Loop" post hit 2,332. So NO raw URL in the body.
  // (Owner can drop the App Store link as the FIRST COMMENT to keep full reach.)
  const text = `Weekend plans, sorted. 🙂\n\nHere's what's happening around ${cities} this weekend:\n\n${body}\n\nMore going on than we can fit here. Full list, times, and directions are in the app. Search "Local Loop" in the App Store, it's free.\n\nWhat's your family getting into this weekend?`;
  return { text, ok: !weak, note: weak ? 'Thin weekend (few marquee events) — review before posting, or skip this week.' : '' };
}

// --- MIDWEEK SPOTLIGHT (Tue, one standout, no link, no repeats within 14d) ---
const FEAT = new URL('.fb-featured.json', DIR);
const featLog = () => { try { return JSON.parse(readFileSync(FEAT, 'utf8')); } catch { return {}; } };
async function genSpotlight() {
  const today = etDay(new Date().toISOString());
  // A real draw, a few days out (not today) — never a same-day library program.
  const upcoming = (await fetchEvents(10)).filter((e) => e._d > today && BIGDRAW.test(e.title) && !FILLER.test(e.title));
  if (!upcoming.length) return { ...genEngagement(), fellBack: true, note: 'No standout event in the next 10 days — used a community question instead.' };
  const recent = featLog();
  const cutoff = Date.now() - 14 * 86400000;
  const fresh = upcoming.filter((e) => { const t = recent[sig(e.title)]; return !t || new Date(t).getTime() < cutoff; });
  const pool = (fresh.length ? fresh : upcoming);
  const pick = pool.map((e) => ({ e, s: scoreOf(e) })).sort((a, b) => b.s - a.s || (new Date(a.e.start_at) - new Date(b.e.start_at)))[0].e;
  const v = cleanVenue(pick.venue);
  const hasV = v && pick.title.toLowerCase().includes(v.replace(/…$/, '').toLowerCase());
  const place = (v && !hasV) ? `is coming to ${v} in ${cap(pick.city_id)}` : `is happening in ${cap(pick.city_id)}`;
  const when = pick._t.h24 >= 8 ? ` Starts at ${pick._t.time}.` : '';
  const text = `Marking your calendar for you. 📅\n\n${pick.title} ${place} on ${etLong(pick.start_at)}, ${etMonthDay(pick.start_at)}.${when}\n\nHope to see some of you there.`;
  try { const log = featLog(); log[sig(pick.title)] = new Date().toISOString(); writeFileSync(FEAT, JSON.stringify(log, null, 2)); } catch { /* non-fatal */ }
  return { text, ok: true, note: '' };
}

// --- TODAY / TONIGHT (Sat, day-of, no link; falls back to a question) ---
async function genTonight() {
  const today = etDay(new Date().toISOString());
  const later = (await fetchEvents(2))
    .filter((e) => e._d === today && new Date(e.start_at) > Date.now())
    .filter((e) => BIGDRAW.test(e.title) && !FILLER.test(e.title)); // only real draws for a public day-of nudge
  // Choose the best 3 by score (priority towns + genuine marquee draws win) rather
  // than whatever starts earliest, so the post leads with a real draw instead of
  // the first farmers market of the morning. Dedupe by title signature + venue.
  const seen = new Set();
  const top = later
    .map((e) => ({ ...e, score: scoreOf(e) }))
    .sort((a, b) => b.score - a.score || new Date(a.start_at) - new Date(b.start_at))
    .filter((e) => { const k = sig(e.title) + '|' + (cleanVenue(e.venue) || e.city_id).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 3);
  if (!top.length) return { ...genEngagement(), fellBack: true };
  // Display the chosen picks in start-time order.
  top.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  const lead = top[0];
  const extra = top.slice(1);
  const second = extra.length
    ? '\n\nAlso today: ' + extra.map((e) => `${e.title} ${venuePlace(e)}${timeTag(e)}`).join(', ') + '.'
    : '';
  const text = `Looking for something to do today? 👀\n\n${lead.title} kicks off at ${lead._t.time} ${venuePlace(lead)}.${second}\n\nMight be worth the drive.`;
  return { text, ok: true, note: '' };
}

// --- ENGAGEMENT (rotates weekly, no data needed) ---
function genEngagement() {
  const prompts = [
    'Okay, settle a debate for us. Best ice cream stop around here?',
    'Fill in the blank: the one small-town festival everyone should go to at least once is ______.',
    'Best breakfast within 20 minutes of you. Go.',
    "What's a spot around here you always take out-of-town visitors to?",
    'Coffee shop of choice. Where are we all going?',
    "What's the most underrated park or trail in the area?",
    'Pizza place that never misses. Name it.',
    "What's one local event you look forward to every single year?",
  ];
  const wk = Math.floor(Date.now() / (7 * 86400000)) % prompts.length;
  const text = `${prompts[wk]}\n\nDrop it in the comments. We're always looking for new spots to check out. 👇`;
  return { text, ok: true, note: '' };
}

// --- dispatch ---
const META = {
  midweek_spotlight: { name: 'Midweek Spotlight', postWhen: 'Tuesday around 12:00 PM' },
  weekend_digest: { name: 'Weekend Digest', postWhen: 'Thursday around 6:00 PM' },
  tonight: { name: "Today's pick", postWhen: 'Saturday around 10:00 AM' },
  engagement: { name: 'Community question', postWhen: 'today, late morning or early evening' },
};
const gen = { midweek_spotlight: genSpotlight, weekend_digest: genWeekend, tonight: genTonight, engagement: async () => genEngagement() };
if (!gen[TYPE]) { console.error(`unknown --type=${TYPE}. use: ${Object.keys(gen).join(', ')}`); process.exit(1); }

const out = await gen[TYPE]();
const meta = META[TYPE];
console.log(`type=${TYPE}${out.fellBack ? ' (no events today -> community question)' : ''} · ok=${out.ok}${out.note ? ' · ' + out.note : ''}\n`);
console.log(out.text || '(nothing to post)');

if (process.argv.includes('--email')) {
  const key = g('RESEND_API_KEY');
  // The only one of the four Resend senders that had no guard; without it a missing
  // key sends "Bearer undefined" and the 401 surfaces as a generic "email failed".
  if (!key) { console.error('RESEND_API_KEY missing, cannot email.'); process.exit(1); }
  const esc = (s) => (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const skip = !out.ok && !out.text;
  const note = out.note ? `<p style="color:#a15c00"><b>Note:</b> ${esc(out.note)}</p>` : '';
  const linkTip = (TYPE === 'weekend_digest' && !skip) ? `<p style="color:#1f6f54"><b>Reach tip:</b> the post has no clickable link on purpose (external links cut reach hard). For a tappable install link, paste this as the FIRST COMMENT right after posting:<br>${APP}</p>` : '';
  const html = skip
    ? `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px"><p><b>${meta.name}:</b> nothing strong enough to post right now.</p>${note}<p>Nothing to do this slot.</p></div>`
    : `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px"><p><b>${meta.name}</b> — schedule this in Facebook for <b>${meta.postWhen}</b> (or just post it then).</p>${note}<pre style="white-space:pre-wrap;font-family:inherit;background:#f4f2ee;padding:14px;border-radius:10px">${esc(out.text)}</pre>${linkTip}</div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Local Loop <noreply@localloop.io>', to: ['michabw91@gmail.com'], subject: `${meta.name} — post for ${meta.postWhen.split(' around')[0]}`, html }),
  });
  console.log(r.ok ? '\n[emailed to michabw91@gmail.com]' : '\nemail failed: ' + (await r.text()).slice(0, 200));
}
