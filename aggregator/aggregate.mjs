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
import { cityFromLocation } from './towns.mjs';

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

function cleanText(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

// Administrative noise that isn't a real public event — filtered out by title.
const JUNK_RE = /\b(closed|closure|cancel?led|no school|staff only|by appointment|appointment only|private (event|rental|party|booking)|room reserved|reserved for|building reserved|holiday hours|regular hours|open hours|hours of operation|test event|placeholder)\b/i;

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

// All-day events: anchor to local noon so the calendar day never shifts across
// timezones when converted to an ISO timestamp.
function atLocalNoon(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

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

function makeRow(ev, source, start, end) {
  const { venue, address } = deriveVenue(ev.location, source.name);
  const title = cleanText(ev.summary || 'Untitled').slice(0, 200);
  if (JUNK_RE.test(title)) return null; // skip closures, reservations, hours, etc.
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
    price: priceFor(title, cleanText(ev.description)),
    host: source.name,
    description: cleanText(ev.description) || `From ${source.name}.`,
    source_uid,
    image_url: httpsUrl(ev.image),
    ticket_url: httpsUrl(ev.url),
  };
}

async function pullSource(source) {
  const now = Date.now();
  const floor = now - 12 * 60 * 60 * 1000; // keep things that started today
  const cutoff = now + HORIZON_DAYS * 24 * 60 * 60 * 1000;

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

  let totalNew = 0;
  for (const source of sources) {
    process.stdout.write(`\n→ ${source.name} (${source.city_id})\n`);
    let rows;
    try {
      rows = await pullSource(source);
    } catch (e) {
      console.error(`  ! fetch/parse failed: ${e.message}`);
      continue;
    }
    console.log(`  parsed ${rows.length} upcoming events`);

    if (DRY_RUN) {
      rows.slice(0, 8).forEach((r) =>
        console.log(`    • ${r.start_at.slice(0, 16)}  ${r.title}  @ ${r.venue}`)
      );
      continue;
    }

    // Only classify/insert events we don't already have, so the daily run does
    // the minimum work (and spends the minimum on labeling).
    const uids = rows.map((r) => r.source_uid);
    const { data: existing } = await supabase.from('events').select('source_uid').in('source_uid', uids);
    const have = new Set((existing || []).map((r) => r.source_uid));
    const newRows = rows.filter((r) => !have.has(r.source_uid));

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
