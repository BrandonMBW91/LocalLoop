// Findlay Events — calendar aggregator
// Pulls events from public iCal feeds (see the event_sources table) into the
// Supabase `events` table. Aggregated events auto-approve (service-role insert).
//
// Usage:
//   node aggregate.mjs                 # pull every enabled source from the DB
//   node aggregate.mjs --dry-run       # parse + print, write nothing
//   node aggregate.mjs --dry-run --url=https://events.bgsu.edu/calendar.ics --city=bowling-green
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (service-role key — keep secret)

import { createHash } from 'node:crypto';
import ical from 'node-ical';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { classifyEvents, emojiFor } from './classify.mjs';
import { deriveVenue } from './venue.mjs';
import { extractJsonLdEvents } from './jsonld.mjs';
import { PLATFORMS } from './platforms/index.mjs';
import { etToDate, etNoon } from './et.mjs';
import { cityFromLocation } from './towns.mjs';
import { normalizeText, cleanLocation, cleanDescription } from '../src/lib/text.js';

loadDotEnv();

// --- args: split on the FIRST '=' only (URLs contain '=') -------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const raw = a.replace(/^--/, '');
    const i = raw.indexOf('=');
    return i === -1 ? [raw, true] : [raw.slice(0, i), raw.slice(i + 1)];
  })
);

const DRY_RUN = Boolean(args['dry-run']);
const HORIZON_DAYS = Number(args.days || 60);

const EMOJI = {
  Music: '🎶', Family: '👨‍👩‍👧', Food: '🍽️', Sports: '🏅',
  Arts: '🎨', Community: '🤝', Market: '🛍️', Education: '📚',
};

// Strip tags, decode HTML entities (&#8217; &amp; &lt;p&gt;...), and flatten
// smart punctuation, so nothing is ever stored as "Ohio&#8217;s" or with a
// stray "—". Shared with the app + SEO generator via src/lib/text.js.
function cleanText(s) {
  return normalizeText(String(s || '').replace(/<[^>]*>/g, ' ')).slice(0, 1200);
}

// Administrative noise that isn't a real public event — filtered out by title.
// "observed"/"no classes" catch campus holiday closures ("Independence Day Observed").
// "no school/classes" only when NOT followed by a program word (No School Day Camp
// is a real kids' event); "observed" only as a title-ending holiday marker.
const JUNK_RE = /\b(closed|closure|cancel?led|staff only|by appointment|appointment only|private (event|rental|party|booking)|room reserved|reserved for|building reserved|holiday hours|regular hours|open hours|hours of operation|test event|placeholder)\b|\bno (school|classes)\b(?!\s*(day\s*)?(camp|program|party|fun|movie|craft))|\bobserved\b[\])]?\s*(-.*)?$/i;

// National Weather Service alerts sometimes ride in on community iCal feeds
// (e.g. Bluffton Icon) as fake "events." A weather warning is not something to
// attend, so drop it. Matches "NWS ..." and any "<hazard> Warning/Watch/Advisory"
// title (Extreme Heat, Winter Storm, Flood, Tornado, Severe Thunderstorm, etc.).
const WEATHER_RE = /\bNWS\b|\b(heat|wind|winter storm|ice storm|snow|blizzard|flood|coastal flood|tornado|severe thunderstorm|thunderstorm|storm|frost|freeze|hard freeze|wind chill|dense fog|air quality|red flag|hurricane|tropical storm|high surf|rip current|excessive heat|extreme cold)\s+(warning|watch|advisory)\b|\b(warning|watch|advisory)\s+(until|in effect)\b/i;

// Routine government committee/board/commission meetings are administrative
// noise, not public events (Perrysburg council committees, library board
// meetings, etc.). Guarded to the "... Meeting" phrasing plus "City Council" and
// "Committee of the Whole", so real public programs ("Council on Aging talk")
// aren't caught.
const GOV_MEETING_RE = /\b(committee|board|commission|city council|council|trustees?|caucus|council of the whole|committee of the whole)\s+meeting\b|\bcity council\b|\bcommittee of the whole\b/i;

// Municipal closure notices ("City offices will be closed in observance of...")
// slip past the title filter because the title is a plain holiday name. Catch
// them by the closure language that lands in the location/description instead.
const CLOSURE_RE = /\b(offices?|city hall|building|library|branch|facilit)\w*\b[^.]{0,40}\bwill be closed\b|\bclosed in observance\b|\bin observance of\b[^.]{0,30}\bclosed\b/i;

// Only keep https links (no javascript:/http: etc.) for the "Get Tickets" button.
function httpsUrl(raw) {
  const s = typeof raw === 'string' ? raw : (raw && raw.val) || '';
  return /^https:\/\//i.test(s) ? String(s).slice(0, 500) : null;
}

// Library/parks/community events are almost always free — only show a price when
// the text actually signals one, otherwise default to Free (nicer than "See details").
function priceFor(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  if (/\bfree\b|no (cost|charge|admission|fee)/.test(text)) return 'Free';
  if (/\$\d|\bfee\b|\bticket|\badmission\b|\bcost\b|\bpaid\b|\bpurchase\b/.test(text)) return 'See details';
  return 'Free';
}

// All-day events: anchor to noon EASTERN (fixed zone) so the calendar day never
// shifts AND the timestamp is identical whether the run happens on UTC CI or a
// local ET machine — server-local noon minted different source_uids per runner,
// re-inserting every all-day event when the runner changed.
const atLocalNoon = etNoon;

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Fetch the raw iCal text ourselves so we can send browser-like headers
// (some calendars sit behind a WAF that 403s bare requests).
async function fetchICS(url) {
  const res = await fetch(url, {
    headers: {
      // Full browser UA: several feeds' WAFs (PrestoSports, mod_security) 403/406
      // the honest bot UA but allow a browser string.
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept: 'text/calendar, text/plain, */*',
      Referer: new URL(url).origin + '/',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---- near-duplicate guard -------------------------------------------------
// Catches the same event arriving as a variant (renamed program, "TeamA vs
// TeamB" flipped, a "2026" prefix) that hashes to a fresh source_uid. Deliberately
// tight: only same-city events starting within 5 minutes qualify, so recurring
// sessions and sign-up slots (15/30-min offsets) are never touched.
const GENERIC_VENUE = new Set(['meeting', 'room', 'rooms', 'capacity', 'the', 'and', 'floor', 'suite', 'area', 'events']);
const normText = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const titleTokens = (s) => new Set(normText(s).split(' ').filter((w) => w.length > 1));
const venueTokens = (s) => new Set([...titleTokens(s)].filter((w) => !GENERIC_VENUE.has(w)));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const t of a) if (b.has(t)) i++;
  return i / (a.size + b.size - i);
}
function tokensEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}
const etDay = (iso) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(iso));

// A copy of an event that assign-boundaries MOVED to its true town (postal-city
// fix): the DB row sits in boardman while the feed re-parses it as youngstown, so
// same-city dedup can't see it. Cross-city match is deliberately STRICT — exact
// title tokens, near-identical start, and BOTH venues present and matching — so
// "Family Storytime" in two different towns' libraries never merges.
function isRelocatedDupe(a, b) {
  if (a.city_id === b.city_id) return false;
  if (!tokensEqual(titleTokens(a.title), titleTokens(b.title))) return false;
  if (Math.abs(new Date(a.start_at) - new Date(b.start_at)) > 5 * 60000) return false;
  const va = venueTokens(a.venue), vb = venueTokens(b.venue);
  return va.size > 0 && vb.size > 0 && jaccard(va, vb) >= 0.5;
}

function isNearDupe(a, b) {
  if (a.city_id !== b.city_id) return false;
  const ta = titleTokens(a.title), tb = titleTokens(b.title);
  const titleSame = tokensEqual(ta, tb);
  if (!(titleSame || jaccard(ta, tb) >= 0.75)) return false;
  const va = venueTokens(a.venue), vb = venueTokens(b.venue);
  const venueMatch = (!va.size || !vb.size) || jaccard(va, vb) >= 0.5;
  if (!venueMatch) return false; // distinct branch names keep real events apart
  // Identical title + venue on the same Eastern day = the same event, even if the
  // start time was shifted (all-day holiday, or a timezone re-anchor between runs
  // that would otherwise mint a fresh source_uid). Fuzzy title matches still need
  // the tight 5-minute window so recurring sessions stay separate.
  if (titleSame && etDay(a.start_at) === etDay(b.start_at)) return true;
  return Math.abs(new Date(a.start_at) - new Date(b.start_at)) <= 5 * 60000;
}

function makeRow(ev, source, start, end) {
  const { venue: rawVenue, address: rawAddress } = deriveVenue(ev.location, source.name);
  const venue = cleanLocation(rawVenue);
  const address = cleanLocation(rawAddress);
  const title = cleanText(ev.summary || 'Untitled').slice(0, 200);
  if (JUNK_RE.test(title)) return null; // skip closures, reservations, hours, etc.
  if (WEATHER_RE.test(title)) return null; // skip NWS/weather alerts (not events)
  if (GOV_MEETING_RE.test(title)) return null; // skip routine committee/board meetings
  const description = cleanDescription(ev.description) || `From ${source.name}.`;
  // Not an event people attend, even though the title reads like a holiday.
  if (CLOSURE_RE.test(`${venue} ${address} ${description}`)) return null;
  // Assign to the town in the event's location, not the feed's host town.
  // null = the address names a city we don't serve (out of area) → drop it.
  const cityId = cityFromLocation(`${venue} ${address}`, source.city_id);
  if (!cityId) return null;
  const startIso = start.toISOString();
  // Dedup key from the event's stable IDENTITY (town + title + start), not the
  // feed's UID — many feeds (WhoFi) hand out a fresh UID on every fetch, which
  // caused duplicate inserts. Venue/address are deliberately excluded: feeds
  // reformat location strings between runs, which would mint a new hash and
  // reintroduce duplicates of the same event.
  const source_uid = createHash('sha1')
    .update(`${cityId}|${title.toLowerCase()}|${startIso}`)
    .digest('hex')
    .slice(0, 24);
  return {
    city_id: cityId,
    title,
    category: source.default_category || 'Community',
    emoji: EMOJI[source.default_category] || '📅',
    start_at: startIso,
    end_at: end ? end.toISOString() : null,
    venue,
    address,
    price: priceFor(title, description),
    host: source.name,
    description,
    source_uid,
    image_url: httpsUrl(ev.image),
    ticket_url: httpsUrl(ev.url),
  };
}

async function pullSource(source) {
  const now = Date.now();
  const floor = now - 12 * 60 * 60 * 1000; // keep things that started today
  const cutoff = now + HORIZON_DAYS * 24 * 60 * 60 * 1000;

  // Platform connectors (BiblioCommons, Communico, Simpleview, LibraryMarket, …):
  // each returns RAW events ({summary, description, location, url, image, start,
  // end, allDay}) which flow through the SAME makeRow gauntlet as iCal — junk/
  // weather/meeting filters, town routing, hashing — so every source gets
  // identical quality control. Adding a city on any platform = one event_sources
  // row (city_id + host URL); no code changes.
  const platform = PLATFORMS[source.type];
  if (platform) {
    const rows = [];
    for (const ev of await platform.pull(source, { floor, cutoff })) {
      const start = ev.allDay ? atLocalNoon(ev.start) : ev.start;
      const t = start.getTime();
      const end = ev.end || null;
      const endT = end ? end.getTime() : t;
      if (Number.isNaN(t) || endT < floor || t > cutoff) continue;
      const row = makeRow(ev, source, start, end);
      if (row) rows.push(row);
    }
    const seenP = new Set();
    return rows.filter((r) => (seenP.has(r.source_uid) ? false : seenP.add(r.source_uid)));
  }

  const text = await fetchICS(source.url);
  const rows = [];

  // Generic structured-data source: pull schema.org Events out of the page HTML
  // (for venues that don't expose an iCal feed). No recurrence to expand.
  if (source.type === 'jsonld') {
    for (const ev of extractJsonLdEvents(text)) {
      const start = ev.allDay ? atLocalNoon(ev.start) : ev.start;
      const t = start.getTime();
      const end = ev.end || null;
      const endT = end ? end.getTime() : t;
      if (endT < floor || t > cutoff) continue;
      const row = makeRow(ev, source, start, end);
      if (row) rows.push(row);
    }
    const seenJ = new Set();
    return rows.filter((r) => (seenJ.has(r.source_uid) ? false : seenJ.add(r.source_uid)));
  }

  // Revize municipal calendars (e.g. City of Kenton): a plain JSON array of
  // FullCalendar-style events {title, start, end, location, desc (URI-encoded
  // HTML), url}. No recurrence to expand.
  if (source.type === 'revize') {
    let items;
    try { items = JSON.parse(text); } catch { throw new Error('revize: response is not JSON'); }
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || !it.title || !it.start) continue;
      // Revize timestamps are LOCAL Eastern with no zone ("2026-07-04T22:00:00").
      // DST-aware conversion — a hardcoded "-04:00" stored every EST-season
      // (Nov-Mar) event an hour early.
      const et = (s) =>
        /T\d{2}:\d{2}/.test(s) && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(s) ? etToDate(s) : new Date(s);
      const start = et(String(it.start));
      if (!start || Number.isNaN(start.getTime())) continue;
      const end = it.end ? et(String(it.end)) : null;
      const t = start.getTime();
      const endT = end ? end.getTime() : t;
      if (endT < floor || t > cutoff) continue;
      let desc = '';
      try { desc = decodeURIComponent(String(it.desc || '')); } catch { desc = String(it.desc || ''); }
      const row = makeRow(
        { summary: it.title, description: desc, location: it.location || '', url: it.url || null },
        source, start, end
      );
      if (row) rows.push(row);
    }
    const seenR = new Set();
    return rows.filter((r) => (seenR.has(r.source_uid) ? false : seenR.add(r.source_uid)));
  }

  // Bot walls (SiteGround sgcaptcha, Cloudflare) answer 200/202 with an HTML
  // challenge page. Parsing that as iCal silently yields 0 events and stamps the
  // source "ok, 0 events" — a lie. Throw instead so feed-health reports the truth.
  // (Only for the iCal path — jsonld sources legitimately fetch HTML pages.)
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error('response is not iCal (bot challenge or moved feed?)');
  }
  const data = await ical.async.parseICS(text);

  for (const key of Object.keys(data)) {
    const ev = data[key];
    if (!ev || ev.type !== 'VEVENT' || !ev.uid || !ev.start) continue;

    const allDay = ev.datetype === 'date' || ev.start.dateOnly === true;
    const durationMs = ev.end ? new Date(ev.end).getTime() - new Date(ev.start).getTime() : 0;
    const exDates = ev.exdate ? Object.values(ev.exdate).map((d) => new Date(d)) : [];

    // Expand recurring events; otherwise just the single instance.
    let starts;
    if (ev.rrule) {
      try {
        starts = ev.rrule.between(new Date(floor), new Date(cutoff), true);
      } catch {
        starts = [];
      }
    } else {
      starts = [new Date(ev.start)];
    }

    for (const raw of starts) {
      if (exDates.some((ex) => sameDay(ex, raw))) continue; // skip cancelled occurrences
      const start = allDay ? atLocalNoon(raw) : new Date(raw);
      const t = start.getTime();
      // keep if it (or its end) is within the window
      const endT = durationMs ? t + durationMs : t;
      if (endT < floor || t > cutoff) continue;
      const end = durationMs ? new Date(t + durationMs) : null;
      const row = makeRow(ev, source, start, end);
      if (row) rows.push(row);
    }
  }

  const seen = new Set();
  return rows.filter((r) => (seen.has(r.source_uid) ? false : seen.add(r.source_uid)));
}

async function getClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function main() {
  let sources;
  let supabase = null;

  if (args.url) {
    sources = [{
      city_id: args.city || 'findlay',
      name: args.name || 'Test feed',
      url: args.url,
      type: args.type || 'ical',
      default_category: args.category || 'Community',
    }];
  } else {
    supabase = await getClient();
    const { data, error } = await supabase.from('event_sources').select('*').eq('enabled', true);
    if (error) throw error;
    sources = data || [];
  }
  if (!DRY_RUN && !supabase) supabase = await getClient();

  const apiKey = process.env.ANTHROPIC_API_KEY; // optional: AI category labels
  if (!DRY_RUN && !apiKey) {
    console.log('(no ANTHROPIC_API_KEY — new events keep their source default category)');
  }

  // Per-source health stamps (see supabase/feed_health.sql) — a feed that dies
  // shows up in feed-health.mjs instead of a town silently emptying out.
  const stamp = async (source, patch) => {
    if (DRY_RUN || !supabase || !source.id) return;
    try { await supabase.from('event_sources').update({ last_pulled_at: new Date().toISOString(), ...patch }).eq('id', source.id); } catch {}
  };

  let totalNew = 0;
  for (const source of sources) {
    process.stdout.write(`\n→ ${source.name} (${source.city_id})\n`);
    let rows;
    try {
      rows = await pullSource(source);
    } catch (e) {
      console.error(`  ! fetch/parse failed: ${e.message}`);
      await stamp(source, { last_error: String(e.message).slice(0, 300) });
      continue;
    }
    console.log(`  parsed ${rows.length} upcoming events`);
    await stamp(source, { last_ok_at: new Date().toISOString(), last_event_count: rows.length, last_error: null });

    if (DRY_RUN) {
      rows.slice(0, 8).forEach((r) =>
        console.log(`    • ${r.start_at.slice(0, 16)}  ${r.title}  @ ${r.venue}`)
      );
      continue;
    }

    // Only classify/insert events we don't already have, so the daily run does
    // the minimum work (and spends the minimum on labeling). Chunked — a single
    // .in() with 1000+ uids overflows the request URL, and an unchecked error
    // here made `have` empty, re-treating EVERY row as new.
    const uids = rows.map((r) => r.source_uid);
    const have = new Set();
    let lookupFailed = false;
    for (let i = 0; i < uids.length; i += 500) {
      const { data: existing, error: exErr } = await supabase
        .from('events').select('source_uid').in('source_uid', uids.slice(i, i + 500));
      if (exErr) {
        console.error(`  ! uid lookup failed (${exErr.message}) — skipping source this run`);
        lookupFailed = true;
        break;
      }
      (existing || []).forEach((r) => have.add(r.source_uid));
    }
    if (lookupFailed) continue;
    let newRows = rows.filter((r) => !have.has(r.source_uid));

    // Near-dupe guard: drop variants of events we already carry (or that appear
    // twice within this batch) — see isNearDupe for the exact rule.
    if (newRows.length) {
      // No city filter: assign-boundaries may have MOVED our earlier copy to its
      // true town, which a city-scoped fetch could never see (the row would then
      // re-insert under the postal city every day). isRelocatedDupe handles the
      // cross-city comparison strictly.
      const starts = newRows.map((r) => new Date(r.start_at).getTime());
      const lo = new Date(Math.min(...starts) - 3600000).toISOString();
      const hi = new Date(Math.max(...starts) + 3600000).toISOString();
      const dbRows = [];
      for (let from = 0; ; from += 1000) {
        const { data: page } = await supabase
          .from('events')
          .select('city_id,title,start_at,venue')
          .gte('start_at', lo)
          .lte('start_at', hi)
          .range(from, from + 999);
        dbRows.push(...(page || []));
        if (!page || page.length < 1000) break;
      }
      const kept = [];
      let skipped = 0;
      for (const r of newRows) {
        if (dbRows.some((e) => isNearDupe(r, e) || isRelocatedDupe(r, e)) || kept.some((k) => isNearDupe(r, k))) skipped++;
        else kept.push(r);
      }
      if (skipped) console.log(`  skipped ${skipped} near-duplicate(s)`);
      newRows = kept;
    }

    if (!newRows.length) {
      console.log('  no new events');
      continue;
    }

    // AI category labels for the new events (best-effort; never blocks inserts).
    if (apiKey) {
      try {
        const cats = await classifyEvents(
          newRows.map((r) => ({ title: r.title, description: r.description })),
          apiKey
        );
        newRows.forEach((r, i) => {
          r.category = cats[i];
          r.emoji = emojiFor(cats[i]);
        });
        console.log(`  labeled ${newRows.length} with Claude`);
      } catch (e) {
        console.error(`  ! labeling failed (${e.message}); keeping source defaults`);
      }
    }

    const { data, error } = await supabase
      .from('events')
      .upsert(newRows, { onConflict: 'source_uid', ignoreDuplicates: true })
      .select('id');
    if (error) {
      console.error(`  ! write error: ${error.message}`);
      continue;
    }
    const added = data ? data.length : 0;
    totalNew += added;
    console.log(`  added ${added} new event(s)`);
  }

  // Expire any featured promotions / ads that have passed their end date.
  if (!DRY_RUN && supabase) {
    const { error } = await supabase.rpc('expire_promotions');
    if (error) console.error(`  ! expire_promotions failed: ${error.message}`);
    else console.log('  expired lapsed promotions/ads');
  }

  console.log(`\nDone.${DRY_RUN ? ' (dry run — nothing written)' : ` Added ${totalNew} new event(s).`}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
