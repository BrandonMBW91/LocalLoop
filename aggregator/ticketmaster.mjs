// Pull ticketed events (concerts, theater, sports, family shows) from the
// Ticketmaster Discovery API into the events table. Covers the bigger NW Ohio
// markets that iCal feeds miss. Free API key: developer.ticketmaster.com →
// "Get Your API Key" → put it in aggregator/.env as TICKETMASTER_API_KEY.
//
//   node ticketmaster.mjs              # pull + write
//   node ticketmaster.mjs --dry-run    # print, write nothing

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { cityFromLocation } from './towns.mjs';
import { ANCHORS, geohash } from './geo.mjs';
import { joinAddressParts, cleanEventTitle } from './venue.mjs';

loadDotEnv();

const DRY_RUN = process.argv.includes('--dry-run');
const KEY = process.env.TICKETMASTER_API_KEY;
const HORIZON_DAYS = 90;

// Ticketmaster classification segment -> our app category.
const SEGMENT_CAT = {
  Music: 'Music', Sports: 'Sports', 'Arts & Theatre': 'Arts',
  Film: 'Arts', Miscellaneous: 'Community',
};
const EMOJI = {
  Music: '🎶', Family: '👨‍👩‍👧', Food: '🍽️', Sports: '🏅',
  Arts: '🎨', Community: '🤝', Market: '🛍️', Education: '📚',
};

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
}

// Pick a good promo image: prefer a wide 16:9 around 1024px.
function pickImage(images) {
  if (!Array.isArray(images) || !images.length) return '';
  const wide = images.filter((i) => i.ratio === '16_9' && i.url);
  const pool = wide.length ? wide : images.filter((i) => i.url);
  if (!pool.length) return '';
  pool.sort((a, b) => Math.abs((a.width || 0) - 1024) - Math.abs((b.width || 0) - 1024));
  return pool[0].url;
}

async function fetchAnchor(a) {
  const now = new Date().toISOString().slice(0, 19) + 'Z';
  const end = new Date(Date.now() + HORIZON_DAYS * 86400000).toISOString().slice(0, 19) + 'Z';
  const gp = geohash(a.lat, a.lng);
  const out = [];
  for (let page = 0; page < 5; page++) {
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${KEY}`
      + `&geoPoint=${gp}&radius=${a.radius}&unit=miles&countryCode=US&size=100&page=${page}&sort=date,asc`
      + `&startDateTime=${now}&endDateTime=${end}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
    const data = await res.json();
    const evs = data._embedded?.events || [];
    out.push(...evs);
    if (page + 1 >= (data.page?.totalPages || 1) || evs.length === 0) break;
  }
  return out;
}

// TM's info/pleaseNote fields often carry venue TICKET TERMS (bag policy, will
// call, 'Place Order'), or the cancellation/refund notice — none of which is an
// event description a reader should see.
const TICKET_TERMS_RE = /valid (?:photo )?ID|Place Order|bag policy|will call|CASHLESS|clear bags?|no re-?entry|box office (?:opens|hours)|refund/i;

function toRow(ev, cityId) {
  // Cancelled shows must not list as upcoming (their info is the refund notice).
  const statusCode = ev.dates?.status?.code;
  if (statusCode === 'cancelled' || statusCode === 'canceled') return null;
  const title = clean(ev.name);
  const startIso = ev.dates?.start?.dateTime
    || (ev.dates?.start?.localDate ? new Date(`${ev.dates.start.localDate}T${ev.dates.start.localTime || '19:00'}:00`).toISOString() : null);
  if (!title || !startIso) return null;

  const venue = ev._embedded?.venues?.[0];
  const venueName = clean(venue?.name);
  // joinAddressParts skips parts line1 already carries (TM often packs city/state/zip in).
  const address = clean(joinAddressParts([venue?.address?.line1, venue?.city?.name, venue?.state?.stateCode, venue?.postalCode]));
  const seg = ev.classifications?.[0]?.segment?.name;
  const isFamily = ev.classifications?.[0]?.family === true;
  const category = isFamily ? 'Family' : (SEGMENT_CAT[seg] || 'Community');
  const lat = venue?.location?.latitude ? Number(venue.location.latitude) : null;
  const lng = venue?.location?.longitude ? Number(venue.location.longitude) : null;
  // Assign to the venue's actual town, not the query town (TM returns metro-wide).
  // null = an out-of-area city we don't serve → drop it.
  const assignedCity = cityFromLocation(`${venueName} ${venue?.city?.name || ''} ${address}`, cityId);
  if (!assignedCity) return null;

  // Same content-hash scheme as the iCal aggregator, so a show listed by both
  // Ticketmaster and a venue feed de-dupes to one row.
  const source_uid = createHash('sha1')
    .update(`${assignedCity}|${title.toLowerCase()}|${startIso}`)
    .digest('hex').slice(0, 24);

  const priceRange = ev.priceRanges?.[0];
  // A $0 minimum is a free event — every other free listing says 'Free'.
  const price = priceRange
    ? (Math.round(priceRange.min) === 0 ? 'Free' : `$${Math.round(priceRange.min)}${priceRange.max > priceRange.min ? '+' : ''}`)
    : 'See tickets';

  return {
    city_id: assignedCity, title: cleanEventTitle(title, assignedCity) || title, category, emoji: EMOJI[category] || '📅',
    start_at: startIso, end_at: null, venue: venueName, // no 'See venue' placeholder — a blank venue hides Follow/directions cleanly
    address, price, host: 'Ticketmaster',
    // pleaseNote is ALWAYS policy text; info only when it isn't ticket terms.
    description: (() => { const i = clean(ev.info || ''); return i && !TICKET_TERMS_RE.test(i) ? i : `${title} — tickets via Ticketmaster.`; })(),
    source_uid, lat, lng, image_url: pickImage(ev.images),
    ticket_url: /^https:\/\//i.test(ev.url || '') ? ev.url : null,
  };
}

async function main() {
  if (!KEY) {
    console.error('Missing TICKETMASTER_API_KEY. Get a free key at developer.ticketmaster.com and add it to aggregator/.env');
    process.exit(1);
  }
  const seen = new Set();
  const rows = [];
  // Anchors that the API refused. Ticketmaster is NOT in event_sources, so a failure
  // here writes no last_error anywhere and feed-health is blind to it by construction:
  // the towns just quietly stop getting concerts and the run still exits 0. Collect
  // them and fail loudly at the end instead.
  const failedAnchors = [];
  for (const a of ANCHORS) {
    let events = [];
    try {
      events = await fetchAnchor(a);
    } catch (e) {
      console.error(`  ! ${a.name}: ${e.message}`);
      failedAnchors.push(`${a.name}: ${String(e.message).slice(0, 120)}`);
      continue;
    }
    let n = 0;
    for (const ev of events) {
      const row = toRow(ev, a.city);
      if (!row || seen.has(row.source_uid)) continue;
      seen.add(row.source_uid);
      rows.push(row);
      n++;
    }
    console.log(`  ${a.name}: ${n} events`);
  }

  if (DRY_RUN) {
    rows.slice(0, 12).forEach((r) => console.log(`    • ${r.start_at.slice(0, 16)}  [${r.category}] ${r.title} @ ${r.venue}`));
    console.log(`\n${rows.length} events (dry run — nothing written)`);
    return;
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const uids = rows.map((r) => r.source_uid);
  const have = new Set();
  for (let i = 0; i < uids.length; i += 200) {
    const { data } = await sb.from('events').select('source_uid').in('source_uid', uids.slice(i, i + 200));
    (data || []).forEach((r) => have.add(r.source_uid));
  }
  const newRows = rows.filter((r) => !have.has(r.source_uid));
  if (newRows.length) {
    const { data, error } = await sb.from('events').upsert(newRows, { onConflict: 'source_uid', ignoreDuplicates: true }).select('id');
    if (error) { console.error('write error:', error.message); process.exit(1); }
    console.log(`\nAdded ${data ? data.length : 0} new Ticketmaster event(s).`);
  } else {
    console.log('\nNo new Ticketmaster events.');
  }
  reportFailures(failedAnchors);
}

// Exit non-zero when anchors were refused, so the workflow step goes red and the
// morning brief has something to show. Previously this was one stderr line inside a
// continue-on-error step, i.e. nothing. A THIRD of the anchors failing and the whole
// job succeeding is the exact shape of a silent outage.
function reportFailures(failed) {
  if (!failed.length) return;
  console.error(`\n${failed.length} of ${ANCHORS.length} Ticketmaster anchors FAILED:`);
  for (const f of failed) console.error(`  ${f}`);
  console.error('These towns got no concerts this run. Nothing records that in event_sources,');
  console.error('so this message is the only signal — check the API key and the daily quota.');
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
