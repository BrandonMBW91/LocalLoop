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

loadDotEnv();

const DRY_RUN = process.argv.includes('--dry-run');
const KEY = process.env.TICKETMASTER_API_KEY;
const HORIZON_DAYS = 90;

// city_id -> the city name Ticketmaster files venues under.
const CITY_QUERY = {
  toledo: 'Toledo', findlay: 'Findlay', lima: 'Lima', sandusky: 'Sandusky',
  'bowling-green': 'Bowling Green', tiffin: 'Tiffin', 'van-wert': 'Van Wert',
  bellefontaine: 'Bellefontaine', fostoria: 'Fostoria', perrysburg: 'Perrysburg',
};

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

async function fetchCity(city) {
  const now = new Date().toISOString().slice(0, 19) + 'Z';
  const end = new Date(Date.now() + HORIZON_DAYS * 86400000).toISOString().slice(0, 19) + 'Z';
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${KEY}`
    + `&city=${encodeURIComponent(city)}&stateCode=OH&countryCode=US&size=100&sort=date,asc`
    + `&startDateTime=${now}&endDateTime=${end}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const data = await res.json();
  return data._embedded?.events || [];
}

function toRow(ev, cityId) {
  const title = clean(ev.name);
  const startIso = ev.dates?.start?.dateTime
    || (ev.dates?.start?.localDate ? new Date(`${ev.dates.start.localDate}T${ev.dates.start.localTime || '19:00'}:00`).toISOString() : null);
  if (!title || !startIso) return null;

  const venue = ev._embedded?.venues?.[0];
  const venueName = clean(venue?.name);
  const address = clean([venue?.address?.line1, venue?.city?.name, venue?.state?.stateCode, venue?.postalCode].filter(Boolean).join(', '));
  const seg = ev.classifications?.[0]?.segment?.name;
  const isFamily = ev.classifications?.[0]?.family === true;
  const category = isFamily ? 'Family' : (SEGMENT_CAT[seg] || 'Community');
  const lat = venue?.location?.latitude ? Number(venue.location.latitude) : null;
  const lng = venue?.location?.longitude ? Number(venue.location.longitude) : null;

  // Same content-hash scheme as the iCal aggregator, so a show listed by both
  // Ticketmaster and a venue feed de-dupes to one row.
  const source_uid = createHash('sha1')
    .update(`${cityId}|${title.toLowerCase()}|${startIso}`)
    .digest('hex').slice(0, 24);

  const priceRange = ev.priceRanges?.[0];
  const price = priceRange ? `$${Math.round(priceRange.min)}${priceRange.max > priceRange.min ? '+' : ''}` : 'See tickets';

  return {
    city_id: cityId, title, category, emoji: EMOJI[category] || '📅',
    start_at: startIso, end_at: null, venue: venueName || 'See venue',
    address, price, host: 'Ticketmaster',
    description: clean(ev.info || ev.pleaseNote || `${title} — tickets via Ticketmaster.`),
    source_uid, lat, lng,
  };
}

async function main() {
  if (!KEY) {
    console.error('Missing TICKETMASTER_API_KEY. Get a free key at developer.ticketmaster.com and add it to aggregator/.env');
    process.exit(1);
  }
  const seen = new Set();
  const rows = [];
  for (const [cityId, cityName] of Object.entries(CITY_QUERY)) {
    let events = [];
    try {
      events = await fetchCity(cityName);
    } catch (e) {
      console.error(`  ! ${cityName}: ${e.message}`);
      continue;
    }
    let n = 0;
    for (const ev of events) {
      const row = toRow(ev, cityId);
      if (!row || seen.has(row.source_uid)) continue;
      seen.add(row.source_uid);
      rows.push(row);
      n++;
    }
    console.log(`  ${cityName}: ${n} events`);
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
  if (!newRows.length) { console.log('\nNo new Ticketmaster events.'); return; }
  const { data, error } = await sb.from('events').upsert(newRows, { onConflict: 'source_uid', ignoreDuplicates: true }).select('id');
  if (error) { console.error('write error:', error.message); process.exit(1); }
  console.log(`\nAdded ${data ? data.length : 0} new Ticketmaster event(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
