// Weekly opt-in "what's on this weekend" EMAIL digest.
//
//   node weekend-email.mjs                      dry run: plan only, sends nothing
//   node weekend-email.mjs --preview=findlay    print the real subject/text/html
//   node weekend-email.mjs --test=you@x.com     send ONE real email to yourself
//   node weekend-email.mjs --send               the real batch
//   node weekend-email.mjs --send --force       ignore the Friday send window
//   node weekend-email.mjs --send --max=200     cap recipients
//
// NOT the same thing as supabase/functions/weekend-digest, which is the PUSH
// notification. Deliberately named differently: two things called "weekend digest"
// is how the wrong one gets fired at 8am.
//
// WHY A NODE SCRIPT AND NOT AN EDGE FUNCTION. It can import the things a Deno copy
// would have to duplicate and then get wrong: real town display names from
// src/data/cities.js (McArthur, LaRue, St. Marys, Put-in-Bay all survive a naive
// titlecase as garbage), effectiveEndMs for the noon/midnight all-day anchors, and
// the shared publish-time safety gate.
//
// THE TWO THINGS MOST LIKELY TO GO WRONG HERE, both guarded below:
//   1. Mailing someone who did not confirm, or who unsubscribed. That is not a
//      deliverability problem, it is a legal one.
//   2. Double-sending. last_sent_at is claimed BEFORE the send, so a crash costs one
//      subscriber one week and can never send twice.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv } from './env.mjs';
import { etWallToDate, wallParts } from './et.mjs';
import { isUnsafe, MARQUEE, FILLER, isShouty, scrubDashes } from './content-safety.mjs';
import { CITIES } from '../src/data/cities.js';
import { effectiveEndMs } from '../src/lib/eventTime.js';
import { cleanText, cleanLocation } from '../src/lib/text.js';

loadDotEnv();
const HERE = dirname(fileURLToPath(import.meta.url));
const TZ = 'America/New_York';

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
const has = (k) => process.argv.includes(`--${k}`);
const SEND = has('send');
const FORCE = has('force');
const PREVIEW = arg('preview');
const TEST_TO = arg('test');
const ONLY_TOWN = arg('town');
const MAX = Number(arg('max') || 500);

const RESEND_EP = 'https://api.resend.com/emails';
const FN_BASE = 'https://wtaefyspddadcrnovumk.supabase.co/functions/v1/digest-subscribe';
const SITE = 'https://localloop.io';
// Bulk subdomain, verified 2026-07-21. NOT localloop@ (the cold-outreach identity
// being warmed on Zoho — consumer spam complaints would land on its d= and degrade
// the channel that actually earns) and NOT noreply@ (no mailbox, bounces).
const FROM = 'Local Loop <events@mail.localloop.io>';
const REPLY_TO = 'localloop@localloop.io';
const OPS_FROM = 'Local Loop <noreply@localloop.io>';
const OPS_TO = 'michabw91@gmail.com';
const MIN_EVENTS = 3;   // below this a town gets NO email; a 1-line digest reads broken
const MAX_ROWS = 9;     // whole-mail cap
const PER_DAY = 4;      // per-day cap, so a metro is not all Friday morning
const GAP_MS = 600;     // ~1.6 req/s, sequential
const CARRY_BACK_H = 12;

const CITY = new Map(CITIES.map((c) => [c.id, c]));
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ---------- Eastern-time helpers (CI runs in UTC; every date decision is ET) ------
const etParts = (iso) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(iso));
  const g = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return { dow: g('weekday'), mon: g('month'), day: g('day'), time: `${g('hour')}:${g('minute')} ${g('dayPeriod')}`.replace(':00 ', ' ') };
};
const etDayKey = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const etHour = (iso) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(new Date(iso)));
const etWeekday = (d) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d);

// All-day anchors: noon ET with no end, or midnight ET spanning its own day. Mirrors
// isAllDayAnchor in the app and isAllDayIso in generate-events.mjs. Without this a
// midnight-anchored row renders "12 AM" and reads as a finished overnight event.
const isAllDay = (e) => {
  const s = etParts(e.start_at);
  if (s.time === '12 PM' && !e.end_at) return true;
  if (s.time !== '12 AM') return false;
  if (!e.end_at) return true;
  const span = new Date(e.end_at) - new Date(e.start_at);
  return span >= 23.5 * 3600e3 && span <= 24.5 * 3600e3;
};
const timeRange = (e) => {
  const allDay = isAllDay(e);
  const s = etParts(e.start_at);
  if (!e.end_at) return allDay ? 'All day' : s.time;
  const en = etParts(e.end_at);
  if (etDayKey(e.start_at) === etDayKey(e.end_at)) return allDay ? 'All day' : `${s.time} - ${en.time}`;
  return `${allDay ? 'All day' : s.time} through ${en.mon} ${en.day}`;
};

// Next Monday 00:00 ET. Built by ET wall-clock parts and etWallToDate's offset
// convergence, never by adding 7*86400e3 to a timestamp, which drifts an hour across
// a DST boundary and would silently move the weekend window.
function nextMondayStartET(now) {
  const p = wallParts(now);
  const dowIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(etWeekday(now));
  const delta = ((8 - dowIdx) % 7) || 7; // always strictly forward
  const anchor = new Date(Date.UTC(p.y, p.mo - 1, p.d + delta));
  return etWallToDate(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, anchor.getUTCDate(), 0, 0, 0);
}

// ---------- copy helpers -------------------------------------------------------
const cleanTitle = (t) => scrubDashes(cleanText(t) || '').replace(/\s+/g, ' ').trim();
// Venues come from feeds and can be absurd — one Findlay row lists four pickleball
// courts by number and runs past 120 chars, which wraps to three lines on a phone and
// buries the next event. Cut at the last separator before the limit so it ends on a
// whole place name rather than mid-word.
const cleanVenue = (v) => {
  const s = scrubDashes(cleanLocation(v) || '').replace(/\s+/g, ' ').trim();
  if (s.length <= 58) return s;
  const cut = s.slice(0, 58);
  const at = Math.max(cut.lastIndexOf(','), cut.lastIndexOf(' - '));
  return (at > 24 ? cut.slice(0, at) : cut.trimEnd()).trim();
};

const scoreOf = (e) => {
  let s = 0;
  if (e.featured) s += 10;
  if (MARQUEE.test(e.title)) s += 6;
  if (FILLER.test(e.title)) s -= 8;
  if (isShouty(e.title)) s -= 7;
  const h = etHour(e.start_at);
  if (h >= 10 && h <= 21) s += 3; else if (h < 7) s -= 5;
  s += Math.min(3, (e.view_count || 0) / 25);
  return s;
};

// ---------- pre-flight ---------------------------------------------------------
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
if ((SEND || TEST_TO) && !RESEND_API_KEY) { console.error('Missing RESEND_API_KEY — cannot send.'); process.exit(1); }

// CAN-SPAM applies to opt-in bulk mail too. Required in EVERY mode, so the artifact a
// human proofs in --preview is the artifact that ships.
const POSTAL = (process.env.DIGEST_POSTAL
  || (() => { try { return readFileSync(join(HERE, '..', 'outreach', 'mailing-address.txt'), 'utf8'); } catch { return ''; } })()
).trim();
if (!POSTAL || /^\[SET MAILING ADDRESS/i.test(POSTAL)) {
  console.error('No postal address. Set DIGEST_POSTAL or outreach/mailing-address.txt — required on bulk mail.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const now = new Date();
const nowIso = now.toISOString();
const windowEnd = nextMondayStartET(now);
const backIso = new Date(now.getTime() - CARRY_BACK_H * 3600e3).toISOString();
const todayKey = etDayKey(nowIso);
const tomorrowKey = etDayKey(new Date(now.getTime() + 86400e3).toISOString());
const sendKey = todayKey;

// Send-window guard: a badly queued run must not deliver "this weekend" on Sunday.
if (SEND && !FORCE) {
  const dow = etWeekday(now);
  const hr = etHour(nowIso);
  if (dow !== 'Fri' || hr >= 18) {
    console.error(`Refusing to send: it is ${dow} ${hr}:00 ET. The digest goes out Friday morning. Use --force to override.`);
    process.exit(1);
  }
}

// ---------- build one town's picks ---------------------------------------------
async function pickFor(cityId) {
  const { data, error } = await sb.from('events')
    .select('id,title,category,venue,address,start_at,end_at,featured,view_count')
    .eq('city_id', cityId)
    .eq('status', 'approved') // explicit: the service role bypasses RLS entirely
    .or(`start_at.gte.${backIso},end_at.gte.${nowIso}`)
    .lt('start_at', windowEnd.toISOString())
    .order('start_at', { ascending: true }).order('id', { ascending: true })
    .limit(500);
  if (error) return { error: error.message, kept: [], total: 0 };

  const nowMs = now.getTime();
  const seenTitle = new Set();
  const seenSig = new Set();
  const survivors = [];
  for (const e of data || []) {
    if (effectiveEndMs(e.start_at, e.end_at, e.title, e.category) < nowMs) continue;
    const title = cleanTitle(e.title);
    const venue = cleanVenue(e.venue || e.address);
    // Screen the RAW title, the cleaned title AND the venue. Cleaning truncates, so
    // screening only the clean form lets an adult term past the cut-off through; the
    // venue is rendered, so it needs the same gate.
    if (isUnsafe(e.title) || isUnsafe(title) || (venue && isUnsafe(venue))) continue;
    if (title.length < 4) continue;
    const k = title.toLowerCase();
    if (seenTitle.has(k)) continue;
    const sig = `${k}|${venue.toLowerCase()}|${etDayKey(e.start_at)}`;
    if (seenSig.has(sig)) continue;
    seenTitle.add(k); seenSig.add(sig);
    survivors.push({ ...e, title, venue });
  }

  // Group by display day, clamping carry-ins up to today so a festival that opened
  // Thursday appears under Today rather than in the past.
  const byDay = new Map();
  for (const e of survivors) {
    const k = etDayKey(e.start_at);
    const key = k < todayKey ? todayKey : k;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push({ ...e, _carry: k < todayKey });
  }
  const kept = [];
  for (const key of [...byDay.keys()].sort()) {
    const day = byDay.get(key).sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, PER_DAY)
      .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    for (const e of day) kept.push({ ...e, _day: key });
  }
  return { kept: kept.slice(0, MAX_ROWS), total: survivors.length };
}

// ---------- render -------------------------------------------------------------
const dayLabel = (key, sampleIso) => {
  if (key === todayKey) return 'Today';
  if (key === tomorrowKey) return 'Tomorrow';
  const p = etParts(sampleIso);
  return `${p.dow}, ${p.mon} ${p.day}`;
};
const whenLine = (e) => {
  if (!e._carry) return timeRange(e);
  if (e.end_at && etDayKey(e.end_at) !== etDayKey(e.start_at)) {
    const en = etParts(e.end_at);
    return `On now, through ${en.mon} ${en.day}`;
  }
  return 'On now';
};

function render(city, kept, total, token) {
  const unsubUrl = `${SITE}/digest/unsubscribe/${token}`;
  const headline = kept[0]?.title || '';
  let subject = total > 1 && headline
    ? `${city.name} this weekend: ${headline} and ${total - 1} more`
    : `${city.name} this weekend: ${total} things to do`;
  subject = scrubDashes(subject);
  if (subject.length > 68) subject = `${subject.slice(0, 65).trimEnd()}...`;

  const days = [];
  let cur = null;
  for (const e of kept) {
    if (!cur || cur.key !== e._day) { cur = { key: e._day, label: dayLabel(e._day, e.start_at), rows: [] }; days.push(cur); }
    cur.rows.push(e);
  }

  const rowsHtml = days.map((d) => `
      <tr><td style="padding:18px 22px 6px 22px;font:600 13px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#8a8a8a;">${esc(d.label)}</td></tr>
      ${d.rows.map((e) => `<tr><td style="padding:8px 22px;">
        <a href="${esc(`${SITE}/event/${e.id}`)}" style="font:600 17px/1.35 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#15315B;text-decoration:none;">${esc(e.title)}</a>
        <div style="font:400 14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#5a5a5a;margin-top:3px;">${esc(whenLine(e))}${e.venue ? ` &middot; ${esc(e.venue)}` : ''}</div>
      </td></tr>`).join('')}`).join('');

  const preheader = kept.slice(0, 2).map((e) => e.title).join(' &middot; ').slice(0, 90);
  const html = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f2;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;">
  <tr><td style="background:#15315B;padding:18px 22px;">
    <div style="font:700 19px/1.2 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#ffffff;">Local Loop</div>
    <div style="font:400 14px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#8FA6C4;margin-top:2px;">${esc(city.name)} this weekend</div>
  </td></tr>
  ${rowsHtml}
  <tr><td style="padding:18px 22px 8px 22px;">
    <a href="${esc(`${SITE}/events/${city.id}.html`)}" style="display:inline-block;background:#D64545;color:#ffffff;font:600 15px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:12px 18px;border-radius:10px;text-decoration:none;">See everything in ${esc(city.name)}</a>
  </td></tr>
  <tr><td style="padding:14px 22px 22px 22px;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#9a9a9a;border-top:1px solid #eeeeee;">
    You are getting this because you asked for ${esc(city.name)} events at localloop.io.<br>
    ${esc(POSTAL.replace(/\n/g, ', '))}<br>
    <a href="${esc(unsubUrl)}" style="color:#9a9a9a;">Unsubscribe</a>
  </td></tr>
</table></td></tr></table>`;

  const text = [
    `${city.name} this weekend`, '',
    ...days.flatMap((d) => [d.label.toUpperCase(), ...d.rows.map((e) => `  ${e.title}\n  ${whenLine(e)}${e.venue ? ` · ${e.venue}` : ''}\n  ${SITE}/event/${e.id}`), '']),
    `See everything in ${city.name}: ${SITE}/events/${city.id}.html`, '',
    `You are getting this because you asked for ${city.name} events at localloop.io.`,
    POSTAL.replace(/\n/g, ', '), '',
    'Unsubscribe:', unsubUrl, '',
  ].join('\n');

  return { subject, html, text, unsubUrl };
}

// ---------- send ---------------------------------------------------------------
async function sendOne(row, city, kept, total) {
  // Belt and braces: a token is a credential. If these ever disagree we would be
  // mailing one person's unsubscribe link to somebody else.
  if (!row.email) throw new Error('row has no email');
  const { subject, html, text } = render(city, kept, total, row.token);
  const r = await fetch(RESEND_EP, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [row.email],
      reply_to: REPLY_TO,
      subject, text, html,
      headers: {
        // Points DIRECTLY at the function, not the branded /digest/unsubscribe/ path.
        // That path is a 302 to another origin, and providers that decline to follow a
        // cross-origin redirect on the one-click POST record the unsubscribe as FAILED
        // — which turns an opt-out into a spam complaint. This header is machine-read
        // and never shown; the human-visible link in the footer stays branded.
        'List-Unsubscribe': `<${FN_BASE}?unsubscribe=${encodeURIComponent(row.token)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'List-Id': 'Local Loop weekend email <digest.localloop.io>',
        Precedence: 'bulk',
        'X-Entity-Ref-ID': `${sendKey}:${row.id}`,
      },
    }),
  });
  if (!r.ok) throw new Error(`resend ${r.status} ${(await r.text()).slice(0, 200)}`);
  return true;
}

// ---------- modes --------------------------------------------------------------
const picksCache = new Map();
const getPicks = async (cityId) => {
  if (!picksCache.has(cityId)) picksCache.set(cityId, await pickFor(cityId));
  return picksCache.get(cityId);
};

if (PREVIEW || TEST_TO) {
  // Both modes are table-independent on purpose: they must work with an empty
  // subscriber list, and --test must never borrow a real subscriber's token.
  const cityId = ONLY_TOWN || PREVIEW || 'findlay';
  const city = CITY.get(cityId);
  if (!city) { console.error(`Unknown town "${cityId}".`); process.exit(1); }
  const { kept, total, error } = await getPicks(cityId);
  if (error) { console.error(`events query failed: ${error}`); process.exit(1); }
  if (!kept.length) { console.error(`No eligible events for ${city.name} in this window.`); process.exit(1); }
  const synthetic = { id: 'preview', email: TEST_TO || 'preview@example.com', city_id: cityId, token: `TEST-${randomUUID()}` };
  const { subject, text } = render(city, kept, total, synthetic.token);
  console.log(`SUBJECT: ${subject}\n`);
  console.log(text);
  if (TEST_TO) {
    await sendOne(synthetic, city, kept, total);
    console.log(`\nSent one test message to ${TEST_TO}. Its unsubscribe token is synthetic, so clicking it changes nothing.`);
  }
  process.exit(0);
}

// ---------- the batch ----------------------------------------------------------
const subs = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('digest_subscribers')
    .select('id,email,city_id,token,confirmed_at,last_sent_at')
    .eq('status', 'confirmed')          // never pending (someone else may have typed it) and never unsubscribed
    .order('last_sent_at', { ascending: true, nullsFirst: true })
    .order('id', { ascending: true })
    .range(from, from + 999);
  // A DB error must NEVER be read as "zero subscribers" and reported as a clean run.
  if (error) { console.error(`subscriber query failed: ${error.message}`); process.exit(1); }
  subs.push(...(data || []));
  if (!data || data.length < 1000) break;
}

const weekStartKey = sendKey;
const seenEmail = new Set();
const unknownTown = [];
const eligible = [];
for (const s of subs) {
  if (!s.confirmed_at) continue;
  if (!s.token || s.token.length < 32) continue;        // no token, no unsubscribe link, no send
  if (!s.email || s.email.length > 254 || !s.email.includes('@')) continue;
  if (!CITY.has(s.city_id)) { unknownTown.push(s.email); continue; }
  if (s.last_sent_at && etDayKey(s.last_sent_at) >= weekStartKey) continue;  // already served this run-day
  if (s.last_sent_at && now - new Date(s.last_sent_at) < 72 * 3600e3) continue;
  const k = s.email.toLowerCase();
  if (seenEmail.has(k)) continue;
  seenEmail.add(k);
  eligible.push(s);
}

const byTown = new Map();
for (const s of eligible) {
  if (ONLY_TOWN && s.city_id !== ONLY_TOWN) continue;
  if (!byTown.has(s.city_id)) byTown.set(s.city_id, []);
  byTown.get(s.city_id).push(s);
}

console.log(`Weekend email — ${subs.length} confirmed, ${eligible.length} eligible, ${byTown.size} town(s), mode=${SEND ? 'SEND' : 'DRY'}`);

let sent = 0, skippedThin = 0, capped = 0;
const failures = [];
const thinTowns = [];
let quotaWall = false;

outer:
for (const [cityId, rows] of byTown) {
  const city = CITY.get(cityId);
  const { kept, total, error } = await getPicks(cityId);
  if (error) { failures.push(`${cityId}: events query failed: ${error}`); continue; }
  // No filler mail. A skipped town keeps its eligibility, so nobody is dropped —
  // they just wait for a week with something on.
  if (kept.length < MIN_EVENTS) { skippedThin += rows.length; thinTowns.push(`${city.name} (${kept.length})`); continue; }
  console.log(`  ${city.name}: ${kept.length} of ${total} events -> ${rows.length} recipient(s)`);
  for (const row of rows) {
    if (sent >= MAX) { capped += 1; continue; }
    if (!SEND) { sent += 1; continue; }
    // Claim BEFORE sending. supabase-js returns errors rather than throwing, so the
    // error is checked: an unstamped send is a guaranteed duplicate next run.
    const { error: claimErr } = await sb.from('digest_subscribers')
      .update({ last_sent_at: new Date().toISOString() }).eq('id', row.id);
    if (claimErr) { failures.push(`${row.email}: claim failed: ${claimErr.message}`); continue; }
    try {
      await sendOne(row, city, kept, total);
      sent += 1;
    } catch (e) {
      const msg = String(e.message || e);
      // Release the claim so a handled failure is retried, rather than costing that
      // subscriber a week for a transient blip.
      await sb.from('digest_subscribers').update({ last_sent_at: row.last_sent_at }).eq('id', row.id);
      if (/\b429\b/.test(msg)) {
        await new Promise((r) => setTimeout(r, 2000));
        try { await sendOne(row, city, kept, total); sent += 1; continue; }
        catch (e2) {
          // Two consecutive 429s is a quota wall, not 300 individual delivery
          // failures. Stop, so the report does not invite rerun-until-green.
          quotaWall = true; failures.push(`quota wall at ${row.email}: ${String(e2.message).slice(0, 120)}`);
          break outer;
        }
      }
      failures.push(`${row.email}: ${msg.slice(0, 160)}`);
    }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
}

// ---------- report -------------------------------------------------------------
const lines = [
  `Weekend email ${SEND ? 'SEND' : 'DRY RUN'} — ${sendKey}`,
  `  confirmed subscribers : ${subs.length}`,
  `  eligible this week    : ${eligible.length}`,
  `  ${SEND ? 'sent' : 'would send'}            : ${sent}`,
  skippedThin ? `  skipped (thin town)   : ${skippedThin} — ${thinTowns.join(', ')}` : '',
  capped ? `  SKIPPED BY --max=${MAX}  : ${capped} (served first next week)` : '',
  unknownTown.length ? `  unknown town rows     : ${unknownTown.length} (${unknownTown.slice(0, 5).join(', ')})` : '',
  failures.length ? `  FAILURES              : ${failures.length}` : '',
  ...failures.slice(0, 20).map((f) => `      ${f}`),
].filter(Boolean);
console.log('\n' + lines.join('\n'));

if (process.env.GITHUB_STEP_SUMMARY) {
  try { (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n'); } catch { /* summary is best-effort */ }
}

// Silence is an alert condition, not a quiet success. A zero here has meant a real
// outage before: the _redirects regression would have frozen every subscriber at
// "pending" with no error anywhere.
const bad = failures.length > 0 || quotaWall || capped > 0
  || (SEND && sent === 0) || (SEND && subs.length === 0);

if (bad && RESEND_API_KEY) {
  const r = await fetch(RESEND_EP, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: OPS_FROM, to: [OPS_TO], reply_to: REPLY_TO,
      subject: `Weekend email needs attention (${sent} sent, ${failures.length} failed)`,
      text: lines.join('\n'),
    }),
  });
  if (!r.ok) console.error(`ops alert failed: ${r.status} ${(await r.text()).slice(0, 160)}`);
}

if (bad) process.exit(1);
