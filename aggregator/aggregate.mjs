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

import ical from 'node-ical';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { classifyEvents, emojiFor } from './classify.mjs';
import { deriveVenue } from './venue.mjs';

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
      'User-Agent': 'Mozilla/5.0 (compatible; FindlayEventsBot/1.0; +https://findlayevents.com)',
      Accept: 'text/calendar, text/plain, */*',
      Referer: new URL(url).origin + '/',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function makeRow(ev, source, start, end, uid) {
  const { venue, address } = deriveVenue(ev.location, source.name);
  return {
    city_id: source.city_id,
    title: cleanText(ev.summary || 'Untitled').slice(0, 200),
    category: source.default_category || 'Community',
    emoji: EMOJI[source.default_category] || '📅',
    start_at: start.toISOString(),
    end_at: end ? end.toISOString() : null,
    venue,
    address,
    price: 'See details',
    host: source.name,
    description: cleanText(ev.description) || `From ${source.name}.`,
    source_uid: uid,
  };
}

async function pullSource(source) {
  const now = Date.now();
  const floor = now - 12 * 60 * 60 * 1000; // keep things that started today
  const cutoff = now + HORIZON_DAYS * 24 * 60 * 60 * 1000;

  const text = await fetchICS(source.url);
  const data = await ical.async.parseICS(text);
  const rows = [];

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
      const uid = ev.rrule
        ? `${ev.uid}-${start.toISOString().slice(0, 10)}`
        : String(ev.uid);
      rows.push(makeRow(ev, source, start, end, uid));
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
