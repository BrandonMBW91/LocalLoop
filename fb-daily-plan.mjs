// Local Loop — daily Facebook-group posting plan.
//
// Reads fb-groups.json (the tracker's own data file), picks the next few groups
// that are still marked "new" (not posted yet), writes a ready-to-paste post
// tailored to each group's type + town, and (with --email) mails Michael the
// plan. Every suggestion is logged to .fb-plan-log.json so the same group is not
// re-suggested for a cooldown window, and so there's a running record.
//
//   node fb-daily-plan.mjs                 dry: print today's plan, send nothing, log nothing
//   node fb-daily-plan.mjs --email         REAL: email the plan to Michael + write the log
//   node fb-daily-plan.mjs --count=5       suggest N groups today (default 3)
//
// The loop: Michael posts the drafts, then marks each group in the tracker
// (Posted / Removed / Pending) with a reason. The tracker auto-saves to
// fb-groups.json, so the next run sees the outcome and stops suggesting done
// groups (and surfaces the removed ones so the approach can be reworked).
//
// Family-safe: adult / profane / broken event titles are hard-dropped before any
// draft is written (same filter the weekend routine uses). No em-dashes, no
// "comment and I'll add it" CTAs — content is self-serve.
import { readFileSync, writeFileSync } from 'node:fs';
import { CITIES } from './src/data/cities.js';

const DIR = new URL('.', import.meta.url);
const read = (p) => { try { return readFileSync(new URL(p, DIR), 'utf8'); } catch { return ''; } };
const env = read('.env') + '\n' + read('aggregator/.env');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const SB = g('EXPO_PUBLIC_SUPABASE_URL') || g('SUPABASE_URL');
const KEY = g('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const TZ = 'America/New_York';
const ADVERTISE = 'localloop.io/advertise';

const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.split('=')[1] : d; };
const EMAIL = process.argv.includes('--email');
const REMIND = process.argv.includes('--remind'); // reminder-only: no new picks, no log write
const PREVIEW = process.argv.includes('--preview'); // build the email HTML and print it, send nothing
const DAILY_TARGET = Math.max(1, Number(arg('count', '3')) || 3);
const COOLDOWN_DAYS = 10;      // don't re-suggest a group for this many days once emailed
const FOLLOWUP_DAYS = 14;      // check-back window: recently-suggested groups now pending/posted
const GROUPS_FILE = 'fb-groups.json';
const LOG_FILE = '.fb-plan-log.json';

// ---------- time / place helpers (Node has full Intl; ET, DST-correct) ----------
const etDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const etLong = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(new Date(iso));
const etParts = (iso) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(iso));
  const get = (t) => (p.find((x) => x.type === t) || {}).value || '';
  const h24 = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date(iso)));
  return { time: `${get('hour')}:${get('minute')} ${get('dayPeriod')}`.replace(':00 ', ' '), h24 };
};
const todayHuman = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());

const CITY_NAME = Object.fromEntries(CITIES.map((c) => [c.id, c.name]));
const cap = (s) => CITY_NAME[s] || (s || '').split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// ---------- title cleanup (copied from fb-routine.mjs; keep in sync) ----------
function cleanTitle(t) {
  let s = (t || '').replace(/\s*\|\s*.*$/, '')
    .replace(/\s+[-–—]\s+[^-–—]*\b(OH|Ohio)\b.*$/i, '')
    .replace(/\s+(tickets?|presented by).*$/i, '')
    .replace(/\s+[-–—]\s+.*?\b(\d+(?:st|nd|rd|th)?\s+of\s+\d+|market date|outdoor season|week\s+\d+|day\s+\d+|session\s+\d+)\b.*$/i, '')
    .replace(/,\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2}\s*$/, '')
    .replace(/\s{2,}/g, ' ').trim();
  if (s.length > 58) {
    s = s.slice(0, 55); const sp = s.lastIndexOf(' '); if (sp > 30) s = s.slice(0, sp);
    s = s.replace(/["'(,\s–-]+$/, '');
    if ((s.match(/"/g) || []).length % 2) s = s.replace(/\s*"(?=[^"]*$)/, '');
    s = s + '…';
  }
  return s;
}
function cleanVenue(v) {
  if (!v) return '';
  let s = String(v).split(',')[0].trim();
  s = s.split('|')[0].trim();
  s = s.replace(/\s*[-–—]\s*.*$/, '');
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  s = s.replace(/\s{2,}/g, ' ');
  if (/\bcalendars?\b|\blistings?\b|\bcvb\b|visitors bureau|chamber of commerce/i.test(s)) return '';
  if (s.length > 42) s = s.slice(0, 40).trim() + '…';
  return s;
}

// ---------- scoring + safety (copied from fb-routine.mjs; keep in sync) ----------
const MARQUEE = /\b(festival|fest|fair|concert|live music|music|band|farmers?|market|cruise|car show|craft|vendor|parade|carnival|fireworks|tournament|expo|celebration|rodeo|brewery|winery|tasting|comedy|theat(er|re)|movie|food truck|art walk|block party|5k|derby)\b/i;
const FILLER = /\b(playgroup|play ?date|pack and play|tot time|toddler|storytime|story time|open house|workshop|webinar|seminar|class(es)?|meeting|worship|service|mass|bible|support group|blood drive|bingo|office hours|orientation|info session)\b/i;
const isShouty = (t) => { const L = (t.match(/[a-z]/gi) || []).length; const U = (t.match(/[A-Z]/g) || []).length; return L > 8 && U / L > 0.7; };
const ADULT = /\b(bar crawl|pub ?crawl|ladies.?night|ladies'? night|white party|foam party|glow party|21\+|18\+|21 ?and ?(up|over)|casino|poker|slots?|gambl\w*|vape|vaping|hookah|cannabis|marijuana|weed|dispensar\w*|kratom|burlesque|drag (?:brunch|bingo|show)|strip(?:per|tease)?|lingerie|wet ?t.?shirt|beer ?olympics|booze|boozy|wine ?crawl|happy ?hour|after.?dark|adults?.?only|singles? (?:night|mixer)|speed dating|gentlemen'?s club|nightclub|rave)\b/i;
const PROFANITY = /\b(f+u+c+k+\w*|sh[i1]t+\w*|b[i1]tch\w*|bastard|c+u+n+t+|d[i1]ck(?:head|wad)?|a+s+s+h+o+l+e+|jack ?ass|dumb ?ass|c[o0]ck(?:sucker)?|wh[o0]re|slut|f+a+g+\w*|n[i1]gg\w*|tw+a+t|goddamn\w*|g[o0]d ?damn|bull ?sh[i1]t)\b/i;
const MASKED = /[a-z][*#@$]{2,}[a-z]?/i;
const ENTITY = /&#?\w{1,8};/i;
const isGarbage = (t) => {
  const s = (t || '').replace(/…$/, '').trim();
  if (s.length < 6) return true;
  if (ENTITY.test(s)) return true;
  if (/https?:\/\/|www\.|<\/?[a-z]|\{\{|\}\}|Ã.|â€|Â./.test(s)) return true;
  if ((s.match(/[a-z]/gi) || []).length / s.length < 0.5) return true;
  if (/^(test|untitled|tbd|tba|n\/?a|event|new event|sample)\b/i.test(s)) return true;
  if (/(.)\1{4,}/.test(s)) return true;
  return false;
};
const EVENING_TYPE = /\b(comedy|concert|live music|band|party|festival|fest|nightlife|dance|dj|karaoke|trivia|open mic|fireworks|celebration|carnival)\b/i;
const isImplausibleTime = (title, h24) => EVENING_TYPE.test(title) && h24 >= 1 && h24 < 11;
const isUnsafe = (t) => ADULT.test(t) || PROFANITY.test(t) || MASKED.test(t) || isGarbage(t);
const scoreOf = (e) => {
  let s = 1;
  if (MARQUEE.test(e.title)) s += 6;
  if (FILLER.test(e.title)) s -= 8;
  if (isShouty(e.title)) s -= 7;
  const h = e._t.h24;
  if (h >= 10 && h <= 21) s += 3; else if (h < 7) s -= 5;
  return s;
};
const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'at', 'in', 'on', 'for', 'to', 'with', 'live', 'music', 'event', 'night', 'presents', 'featuring', 'ft', 'w']);
const sig = (t) => (t.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w)).sort().join(' ') || t.toLowerCase().replace(/[^a-z0-9]/g, '');
const normName = (x) => (x || '').toLowerCase().replace(/['’]s\b/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(\w+?)s\b/g, '$1').replace(/\s+/g, ' ').trim();
const venuePlace = (e) => {
  const v = cleanVenue(e.venue);
  const vl = v.toLowerCase().replace(/…$/, '');
  const city = cap(e.city_id).toLowerCase();
  const nt = normName(e.title), nv = normName(vl);
  const redundant = !vl || (nv && (nt.includes(nv) || nv.includes(nt))) || vl === city;
  return redundant ? `in ${cap(e.city_id)}` : `at ${v}, ${cap(e.city_id)}`;
};
const timeTag = (e) => (e._t.h24 >= 8 ? ` (${e._t.time})` : '');

const enc = encodeURIComponent;
const q = async (p) => { try { const r = await fetch(`${SB}/rest/v1/${p}`, { headers: H }); return r.ok ? r.json() : []; } catch { return []; } };

// Upcoming approved events for a set of town slugs, cleaned + safety-filtered.
async function fetchEventsFor(cityIds, daysAhead) {
  if (!SB || !KEY || !cityIds.length) return [];
  const lo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const hi = new Date(Date.now() + daysAhead * 86400000).toISOString();
  const inList = cityIds.map((c) => `"${c}"`).join(',');
  const raw = await q(`events?status=eq.approved&city_id=in.(${enc(inList)})&start_at=gte.${enc(lo)}&start_at=lt.${enc(hi)}&select=title,category,city_id,venue,start_at&order=start_at.asc&limit=500`);
  return raw
    .map((e) => ({ ...e, title: cleanTitle(e.title), _t: etParts(e.start_at), _d: etDay(e.start_at) }))
    .filter((e) => CITY_NAME[e.city_id])
    .filter((e) => e.title && e.title.length >= 4)
    .filter((e) => !isUnsafe(e.title) && !isImplausibleTime(e.title, e._t.h24));
}

// Up to `max` de-duped, well-scored event bullets for a town cluster.
async function bulletsForArea(cityIds, max = 4, daysAhead = 9) {
  const all = await fetchEventsFor(cityIds, daysAhead);
  const bySig = new Map();
  for (const e of all) {
    const s = { ...e, score: scoreOf(e) };
    const k = sig(e.title);
    const c = bySig.get(k);
    if (!c || s.score > c.score) bySig.set(k, s);
  }
  const picks = [...bySig.values()].filter((e) => MARQUEE.test(e.title) || e.score > 0)
    .sort((a, b) => b.score - a.score);
  const out = [];
  const perTown = {};
  for (const e of picks) {
    if (out.length >= max) break;
    if ((perTown[e.city_id] || 0) >= 2) continue; // spread across towns in a multi-town area
    out.push(e); perTown[e.city_id] = (perTown[e.city_id] || 0) + 1;
  }
  out.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  return out.map((e) => `• ${e.title} ${venuePlace(e)}${timeTag(e)} on ${etLong(e.start_at)}`);
}

// ---------- area (free text in the tracker) -> catalog town slugs ----------
// Only slugs present in src/data/cities.js pull real event data; unmapped or
// county/regional labels fall back to a data-free post archetype.
const AREA_TO_CITIES = {
  'Springfield': ['springfield'], 'Delaware': ['delaware'], 'Bowling Green': ['bowling-green'],
  'Wooster': ['wooster'], 'Kent': ['kent'], 'Lima': ['lima'], 'Boardman': ['boardman'],
  'Mansfield': ['mansfield'], 'Youngstown': ['youngstown'], 'Akron': ['akron'],
  'Mahoning Valley': ['youngstown', 'boardman', 'austintown', 'warren', 'niles', 'canfield', 'struthers', 'girard'],
  'Warren': ['warren'], 'Beavercreek': ['beavercreek'], 'Cuyahoga Falls': ['cuyahoga-falls'],
  'Perrysburg': ['perrysburg'], 'Troy': ['troy'], 'Piqua': ['piqua'], 'Sidney': ['sidney'],
  'Toledo': ['toledo'], 'Toledo area': ['toledo', 'sylvania', 'perrysburg'], 'Fostoria': ['fostoria'],
  'Massillon': ['massillon'], 'Austintown': ['austintown'], 'Salem': ['salem'], 'Ravenna': ['ravenna'],
  'North Canton': ['north-canton'], 'Canton': ['canton'], 'Medina': ['medina'],
  'Bellefontaine': ['bellefontaine'], 'Marion': ['marion'], 'Bucyrus': ['bucyrus'],
  'Marysville': ['marysville'], 'Van Wert': ['van-wert'], 'Kelleys Island': ['kelleys-island'],
  'Fremont': ['fremont'], 'Port Clinton': ['port-clinton'], 'Sandusky': ['sandusky'],
  'Put-in-Bay': ['put-in-bay'], 'NE Ohio': [], 'Tiffin': ['tiffin'], 'Findlay': ['findlay'],
  'Tiffin/Findlay/Fostoria': ['tiffin', 'findlay', 'fostoria'], 'Putnam County': [], 'Seneca County': ['tiffin'],
};
function citiesForArea(area) {
  if (AREA_TO_CITIES[area]) return AREA_TO_CITIES[area];
  const slug = (area || '').toLowerCase().trim().replace(/\s+/g, '-');
  return CITY_NAME[slug] ? [slug] : [];
}

// ---------- archetype detection from the group's name + rules ----------
function archetypeOf(gr) {
  const name = (gr.name || '');
  const nl = name.toLowerCase();
  const rl = ((gr.rules || '') + ' ' + (gr.notes || '')).toLowerCase();
  // Format-restricted (pictures/media only): a text draft gets removed. Skip.
  if (/pictures? only|photos? only|media only|images? only/i.test(rl)) return 'skip';
  // No-promotion groups NEVER get a hard app pitch. Checked FIRST so it wins over
  // a name-based archetype, and broad enough to catch the many ways groups phrase
  // an ad ban (this is the #1 cause of posts getting removed).
  if (/no ads?\b|not ad space|no advertis|no self.?promot|no soliciting|do not allow (?:sales|business|ad|promot|self)|business advertisement|no business (?:ad|post)|no selling|no sales|no promo|please no business|sales posts (?:are )?not allowed/i.test(rl)) return 'zeropitch';
  if (/food truck/i.test(name)) return 'foodtruck';
  if (/garage|yard sale|buy[\s,\/]*sell[\s,\/]*trade|\bbst\b|\bb\/s\/t\b|freebies|\bsales?\b|swap meet|flea market/i.test(nl)) return 'garage';
  if (/business|networking|small business|entrepreneur/i.test(nl)) return 'advertiser';
  if (/grew up|memories|picture page|you know you.?re from|our home town|so youngstown|nostalg/i.test(nl)) return 'nostalgia';
  return 'community';
}

// ---------- cautions parsed from the group's rules ----------
function cautionsFor(gr) {
  const r = (gr.rules || '') + ' ' + (gr.notes || '');
  const c = [];
  if (/pre.?approv|admin (?:review|approval)|review is still pending|reviewing everyone|approved on|require admin/i.test(r)) c.push('Admin pre-approval, so the post may sit in a queue before it shows.');
  if (/no link|no url|links? (?:are )?not allowed/i.test(r)) c.push('No links: keep the App Store line as plain text, no URL.');
  if (/one post per day|limited you to one post|activity is limited/i.test(r)) c.push('You are rate-limited here (one post/day). Space it out.');
  if (/wednesday|weekly business (?:post|thread)|business post thread|business thread/i.test(r)) c.push('Business posts only on their business-post day/thread, so check before posting.');
  if (/must (?:be|display|have ties)|display ties|personal intro/i.test(r)) c.push('Post from a personal profile with local ties, not the Page, if they require it.');
  return c;
}

// ---------- post drafts per archetype ----------
const CTA_APP = 'Search "Local Loop" in the App Store, it\'s free.';

function communityDraft(area, bullets) {
  const town = cap(citiesForArea(area)[0] || '') || area;
  if (bullets.length >= 2) {
    return `Not sure what's going on around ${town} this week? A few things coming up:\n\n${bullets.join('\n')}\n\nThere's more in the app with times and directions. ${CTA_APP}\n\nWhat's your family getting into this week?`;
  }
  return `Trying to keep up with what's happening around ${town}? We put local events, festivals, and food trucks into one free app so you don't have to dig through five pages to find them.\n\n${CTA_APP}\n\nWhat's one local event you never miss?`;
}
function zeropitchDraft(area, bullets) {
  const town = cap(citiesForArea(area)[0] || '') || area;
  // These groups ban promotion, so lead with pure usefulness and keep the app
  // line soft. If there's nothing to list, there's nothing safe to post here.
  if (bullets.length >= 2) {
    return `A few things coming up around ${town}:\n\n${bullets.join('\n')}\n\nFull list and times are in the Local Loop app if it helps. Hope everyone has a good week.`;
  }
  return '';
}
function garageDraft() {
  return `Garage sale season is on. We built a free app that maps local garage sales and yard sales so you can plan a route instead of driving around blind.\n\n${CTA_APP}\n\nWhat's the best thing you've ever scored at a garage sale?`;
}
function foodtruckDraft(area) {
  const town = cap(citiesForArea(area)[0] || '') || area;
  return `Chasing down where the food trucks are parked around ${town} this week? Our free app tracks local food truck stops so you always know what's rolling through.\n\n${CTA_APP}\n\nWho's your go-to truck around here?`;
}
function nostalgiaDraft(area) {
  const town = cap(citiesForArea(area)[0] || '') || area;
  return `Feel like there was always something going on around ${town} back in the day? We made a free app to help folks find the local stuff again: festivals, fairs, live music, food trucks.\n\n${CTA_APP}\n\nWhat's an event from around here you still think about?`;
}
function advertiserDraft(area) {
  return `Quick one for the local business owners here. We run Local Loop, a hyperlocal events app a lot of ${area} folks use to find what's going on. We're opening sponsor spots for local businesses that want to reach them.\n\nDetails: ${ADVERTISE}\n\nWhat's worked best for you for reaching local customers?`;
}

async function draftFor(gr) {
  const type = archetypeOf(gr);
  const cities = citiesForArea(gr.area);
  const labels = { community: 'Community roundup', zeropitch: 'Events-only (no-promo group)', garage: 'Garage-sale utility', foodtruck: 'Food-truck angle', nostalgia: 'Nostalgia angle', advertiser: 'Advertiser pitch (B2B)', skip: 'Skipped (format-restricted)' };
  let text = '';
  if (type === 'skip') text = '';
  else if (type === 'garage') text = garageDraft();
  else if (type === 'foodtruck') text = foodtruckDraft(gr.area);
  else if (type === 'nostalgia') text = nostalgiaDraft(gr.area);
  else if (type === 'advertiser') text = advertiserDraft(gr.area);
  else if (type === 'zeropitch') { const b = await bulletsForArea(cities); text = zeropitchDraft(gr.area, b); }
  else { const b = await bulletsForArea(cities); text = communityDraft(gr.area, b); }
  return { type, label: labels[type], text, cautions: cautionsFor(gr), cities };
}

// A post draft must never carry an em/en dash in the outward copy (bullets use a
// plain " - " we insert ourselves; guard against a stray one from a title).
const scrubDashes = (s) => (s || '').replace(/\s*[–—]\s*/g, ' - ');

// ---------- log (record + cooldown) ----------
function readLog() { try { const j = JSON.parse(read(LOG_FILE)); return Array.isArray(j) ? j : []; } catch { return []; } }
function recentlySuggested(log) {
  const cutoff = Date.now() - COOLDOWN_DAYS * 86400000;
  const set = new Set();
  for (const e of log) { if (e && e.at && new Date(e.at).getTime() >= cutoff) set.add(e.group); }
  return set;
}

// ---------- pick today's groups ----------
// Ordered candidate list: one-per-area first (sibling-town spacing), then the
// rest appended so a 2nd same-area group is only reached if earlier picks were
// skipped. NOT capped here — the caller drafts down the list until it has
// DAILY_TARGET usable drafts, so a format-restricted group never wastes a slot.
function orderCandidates(groups, excludeNames) {
  // AD-TEST BLACKOUT (through 2026-07-23): the paired FB ad test needs the ad to
  // be the ONLY difference between test and control towns. A free group post in any
  // of the six would contaminate the read, so never suggest them while the flight
  // runs. Delete this block after Jul 23 and the towns come back automatically.
  const AD_TEST_BLACKOUT = { until: '2026-07-23', towns: ['canton', 'sandusky', 'new philadelphia', 'new phila', 'youngstown', 'ashland', 'fremont'] };
  const inBlackout = new Date().toISOString().slice(0, 10) <= AD_TEST_BLACKOUT.until;
  const isBlackedOut = (gr) => inBlackout && AD_TEST_BLACKOUT.towns.some((t) =>
    `${gr.area || ''} ${gr.name || ''}`.toLowerCase().includes(t));

  const pending = groups.filter((gr) => gr.status === 'new' && !excludeNames.has(gr.name) && !isBlackedOut(gr));
  const ordered = [];
  const usedAreas = new Set();
  for (const gr of pending) { if (usedAreas.has(gr.area)) continue; ordered.push(gr); usedAreas.add(gr.area); }
  for (const gr of pending) { if (!ordered.includes(gr)) ordered.push(gr); }
  return ordered;
}

// ---------- main ----------
const groups = (() => {
  try { const j = JSON.parse(read(GROUPS_FILE)); if (!Array.isArray(j) || !j.length) throw 0; return j; }
  catch { console.error(`Cannot read ${GROUPS_FILE} (expected a non-empty JSON array of groups).`); process.exit(1); }
})();

const counts = groups.reduce((a, gr) => { a[gr.status] = (a[gr.status] || 0) + 1; return a; }, {});
const log = readLog();
const excluded = recentlySuggested(log);
const candidates = orderCandidates(groups, excluded);

// Draft down the candidate list until we have DAILY_TARGET usable drafts. A
// skipped (format-restricted) or empty (no-event zero-pitch) group is passed
// over without consuming a slot.
const usable = [];
if (!REMIND) {
  for (const gr of candidates) {
    if (usable.length >= DAILY_TARGET) break;
    const d = await draftFor(gr);
    d.group = gr;
    d.text = scrubDashes(d.text);
    if (d.text && d.text.trim()) usable.push(d);
  }
}

const removed = groups.filter((gr) => gr.status === 'removed');
const pendingApproval = groups.filter((gr) => gr.status === 'pending');
const newLeft = groups.filter((gr) => gr.status === 'new').length;

// Follow-up: groups suggested in the last FOLLOWUP_DAYS that are now awaiting
// approval or posted. Reminds Michael to confirm whether each was approved,
// declined, or removed, then update the tracker.
const statusByName = Object.fromEntries(groups.map((gr) => [gr.name, gr.status]));
const followSince = Date.now() - FOLLOWUP_DAYS * 86400000;
const followSeen = new Set();
const followup = [];
for (const e of log) {
  if (!e || !e.at || new Date(e.at).getTime() < followSince || followSeen.has(e.group)) continue;
  const st = statusByName[e.group];
  if (st === 'pending' || st === 'posted') { followSeen.add(e.group); followup.push({ name: e.group, status: st }); }
}

console.log('LOCAL LOOP FB DAILY PLAN - ' + todayHuman);
console.log(`tracker: ${groups.length} groups · ${counts.new || 0} to post · ${counts.pending || 0} pending · ${counts.posted || 0} posted · ${counts.removed || 0} removed`);
console.log(`suggesting ${usable.length} today (target ${DAILY_TARGET}, ${excluded.size} on cooldown)\n`);
if (!usable.length) console.log('Nothing new to suggest today (all remaining "new" groups were suggested recently, or none are left).');
for (const p of usable) {
  console.log(`\n=== ${p.group.name} (${p.group.area}) - ${p.label} ===`);
  if (p.cautions.length) console.log('CAUTION: ' + p.cautions.join(' | '));
  console.log(p.text);
}
console.log('');
if (followup.length) {
  console.log('CHECK BACK (were these approved, or declined/removed?):');
  for (const f of followup) console.log(`  - ${f.name} [${f.status}]`);
  console.log('');
}

// ---------- email + log (only on the real run) ----------
if (EMAIL || PREVIEW) {
  const key = g('RESEND_API_KEY');
  if (!key && !PREVIEW) { console.error('RESEND_API_KEY missing, cannot email.'); process.exit(1); }
  const esc = (s) => (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const block = (p) => `
    <div style="margin:0 0 22px;padding:0 0 18px;border-bottom:1px solid #e6e1d7">
      <p style="margin:0 0 2px"><b>${esc(p.group.name)}</b> <span style="color:#777">· ${esc(p.group.area)} · ${esc(p.label)}</span></p>
      ${p.cautions.length ? `<p style="margin:4px 0;color:#a15c00;font-size:13px"><b>Heads up:</b> ${esc(p.cautions.join(' '))}</p>` : ''}
      <pre style="white-space:pre-wrap;font-family:inherit;background:#f4f2ee;padding:14px;border-radius:10px;margin:6px 0 0">${esc(p.text)}</pre>
    </div>`;
  const footer = `
    <p style="color:#555;font-size:13px;margin-top:18px">
      After you post, mark each group in your tracker (Posted / Removed / Pending) with a reason. The next plan reads that and stops suggesting done groups.
    </p>
    <p style="color:#555;font-size:13px">
      Status now: <b>${newLeft}</b> still to post · <b>${pendingApproval.length}</b> waiting on admin approval · <b>${removed.length}</b> removed so far.
      ${removed.length ? 'Removed groups are worth a reworded, event-only retry, or a drop. They are in the tracker.' : ''}
    </p>`;
  const followBlock = followup.length ? `
    <div style="margin-top:18px;padding-top:14px;border-top:2px solid #e6e1d7">
      <p style="margin:0 0 6px"><b>Check back on these</b>: were they approved, or declined/removed? Update the tracker so they stop showing here.</p>
      <ul style="margin:0;padding-left:18px;color:#333;font-size:14px">
        ${followup.map((x) => `<li>${esc(x.name)} <span style="color:#777">(${x.status === 'pending' ? 'awaiting approval' : 'posted, confirm it is still up'})</span></li>`).join('')}
      </ul>
    </div>` : '';
  const intro = REMIND
    ? `<p style="margin:0 0 4px"><b>Facebook follow-up check-in for ${esc(todayHuman)}</b></p>
       <p style="color:#555;font-size:13px;margin:0 0 12px">No new groups here, just the posts to check on.</p>`
    : `<p style="margin:0 0 4px"><b>Facebook posting plan for ${esc(todayHuman)}</b></p>
       <p style="color:#555;font-size:13px;margin:0 0 18px">${usable.length} group${usable.length === 1 ? '' : 's'} today. Paste each draft into the group, then mark it in your tracker.</p>`;
  const body = REMIND ? '' : (usable.length
    ? usable.map(block).join('')
    : `<p>Nothing new to post today. Every remaining "new" group was suggested in the last ${COOLDOWN_DAYS} days, or you're caught up. Mark the recent ones in your tracker so they clear.</p>`);
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:600px">
    ${intro}${body}${followBlock}${footer}</div>`;
  const subject = REMIND
    ? `FB check-in: ${followup.length} post${followup.length === 1 ? '' : 's'} to follow up (${todayHuman})`
    : (usable.length ? `FB plan: ${usable.length} group${usable.length === 1 ? '' : 's'} for ${todayHuman}` : `FB plan: caught up (${todayHuman})`);
  if (PREVIEW) {
    console.log('SUBJECT: ' + subject + '\n=====HTML=====\n' + html + '\n=====END=====');
  } else {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Local Loop <noreply@localloop.io>', to: ['michabw91@gmail.com'], subject, html }),
    });
    if (!r.ok) { console.error('email failed: ' + (await r.text()).slice(0, 200)); process.exit(1); }
    console.log('[emailed to michabw91@gmail.com]');

    // Record only what was actually emailed, so cooldown tracks real suggestions.
    // A reminder-only run (--remind) suggests nothing, so it never touches the log.
    if (!REMIND && usable.length) {
      const nowIso = new Date().toISOString();
      for (const p of usable) log.push({ at: nowIso, date: etDay(nowIso), group: p.group.name, area: p.group.area, archetype: p.type });
      try { writeFileSync(new URL(LOG_FILE, DIR), JSON.stringify(log, null, 2)); console.log(`[logged ${usable.length} to ${LOG_FILE}]`); }
      catch (e) { console.error('log write failed (non-fatal): ' + e.message); }
    }
  }
}
