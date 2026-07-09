// Fill events.lat/lng from each event's address (for the map view). Geocodes
// each DISTINCT address once via Mapbox, then applies it to every event there —
// so ~1,700 events cost only a few hundred geocode calls.
//
// Usage:  node geocode.mjs            (fills events missing coords)
//         node geocode.mjs --dry-run  (look up, write nothing)
// Env (aggregator/.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MAPBOX_TOKEN

import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { CITIES } from '../src/data/cities.js';
import { ANCHORS } from './geo.mjs';

loadDotEnv();
const DRY = process.argv.includes('--dry-run');
const ALL = process.argv.includes('--all'); // re-geocode everything, not just missing
const CITY_NAME = Object.fromEntries(CITIES.map((c) => [c.id, c.name]));
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MAPBOX_TOKEN } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MAPBOX_TOKEN) {
  console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or MAPBOX_TOKEN.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Accepted region = the union of every metro anchor's circle (plus a small
// margin), derived at runtime from geo.mjs so adding an anchor automatically
// expands where geocodes are accepted — no more hand-tuned magic bounding box
// silently rejecting a new region's events.
const MARGIN_MI = 10;
const BBOX = ANCHORS.reduce(
  (b, a) => {
    const dLat = (a.radius + MARGIN_MI) / 69; // ~69 mi per degree latitude
    const dLng = (a.radius + MARGIN_MI) / (69 * Math.cos((a.lat * Math.PI) / 180));
    return {
      s: Math.min(b.s, a.lat - dLat), n: Math.max(b.n, a.lat + dLat),
      w: Math.min(b.w, a.lng - dLng), e: Math.max(b.e, a.lng + dLng),
    };
  },
  { s: Infinity, n: -Infinity, w: Infinity, e: -Infinity }
);

// Geocode within our footprint, anchored to the town so a bare venue name
// ("Sandusky Library") doesn't match the same name in another state.
async function geocode(query) {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${MAPBOX_TOKEN}&limit=1&country=US&proximity=-83.65,41.04`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const f = data.features?.[0];
  if (!f?.center) return null;
  // Reject low-confidence matches. A vague/unresolvable address makes Mapbox
  // return a broad centroid (one bogus point shared by 100+ events — the Jul
  // 2026 audit found 156 pinned to a single PA-border coordinate). relevance
  // < 0.8 or a region/country-level match is not a real venue location.
  const badType = ['region', 'country', 'district'].some((t) => (f.place_type || []).includes(t));
  if (typeof f.relevance === 'number' && f.relevance < 0.8) return null;
  if (badType) return null;
  const [lng, lat] = f.center;
  // Reject anything outside the anchor-derived footprint (visible, not silent).
  if (lat < BBOX.s || lat > BBOX.n || lng < BBOX.w || lng > BBOX.e) return null;
  return { lng, lat };
}

async function main() {
  let from = 0, rows = [], page;
  do {
    let q = supabase.from('events').select('id, address, venue, city_id, lat');
    if (!ALL) q = q.is('lat', null);
    const r = await q.range(from, from + 999);
    page = r.data || [];
    rows.push(...page);
    from += 1000;
  } while (page.length === 1000);

  // Group by (address, town) so the same library across towns stays distinct.
  const groups = new Map();
  for (const e of rows) {
    const base = (e.address && e.address.trim()) || (e.venue && e.venue.trim());
    if (!base) continue;
    const town = CITY_NAME[e.city_id];
    const query = town ? `${base}, ${town}, OH` : base;
    const key = `${query}`;
    if (!groups.has(key)) groups.set(key, { query, ids: [] });
    groups.get(key).ids.push(e.id);
  }

  console.log(`${rows.length} events across ${groups.size} distinct address+town combos.`);
  let done = 0, updated = 0, missed = 0;
  for (const { query, ids } of groups.values()) {
    let coords = null;
    try { coords = await geocode(query); } catch {}
    done += 1;
    if (!coords) {
      missed += 1;
      // Clear any stale/bad coords so a wrong pin doesn't linger.
      if (ALL && !DRY) {
        for (let i = 0; i < ids.length; i += 200) {
          await supabase.from('events').update({ lat: null, lng: null }).in('id', ids.slice(i, i + 200));
        }
      }
    } else if (!DRY) {
      for (let i = 0; i < ids.length; i += 200) {
        const slice = ids.slice(i, i + 200);
        const { error } = await supabase.from('events').update({ lat: coords.lat, lng: coords.lng }).in('id', slice);
        if (!error) updated += slice.length;
      }
    }
    process.stdout.write(`\r  ${done}/${groups.size} combos · ${updated} events · ${missed} not found`);
    await new Promise((r) => setTimeout(r, 110)); // stay well under Mapbox rate limits
  }
  process.stdout.write('\n');
  console.log(DRY ? 'dry run — nothing written' : `Done. Geocoded ${updated} events.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
