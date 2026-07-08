// Post-geocode city reassignment by TRUE municipal boundaries.
//
// Name-based routing (towns.mjs) trusts the address text, but postal cities lie:
// Boardman/Austintown addresses read "Youngstown, OH 44512", Portage Lakes reads
// "Akron, OH 44319". Once an event has real coordinates (geocode.mjs), this step
// asks the official Census boundary polygons which served town actually contains
// the point, and moves the event there when the address text got it wrong.
//
//   node assign-boundaries.mjs            # reassign upcoming events
//   node assign-boundaries.mjs --dry-run  # report moves, write nothing
//
// Conservative by design:
//   - only moves an event INTO a served town's polygon (never out of the app)
//   - a point inside no polygon (unincorporated space) keeps its name-based town
//   - QUALITY GATE: only trusts coordinates backed by a real street address or ZIP.
//     Room-only venue strings ("Frohman Room", "Meeting Room B") geocode to junk —
//     verified: every suspicious move group sampled was such a fuzzy match.
//   - ADJACENCY GATE: postal-city corrections are always neighboring towns
//     (Boardman↔Youngstown); geocode junk lands anywhere, so moves over ~25 miles
//     are refused.
//   - idempotent — runs after every daily geocode pass
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { cityAtPoint, loadPolygons } from './citypoly.mjs';
import { milesBetween } from './geo.mjs';
import { CITIES } from '../src/data/cities.js';

loadDotEnv();
const DRY = process.argv.includes('--dry-run');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
if (!loadPolygons().length) {
  console.log('No data/city-polygons.json yet — run build-polygons.mjs first. Skipping.');
  process.exit(0);
}
const served = new Set(CITIES.map((c) => c.id));
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Town centers (polygon bbox midpoints) for the adjacency gate.
const CENTER = Object.fromEntries(
  loadPolygons().map((t) => [t.id, [(t.bbox[1] + t.bbox[3]) / 2, (t.bbox[0] + t.bbox[2]) / 2]])
);
const MAX_MOVE_MI = 25;

// A coordinate is only trustworthy when the event's text carries a real street
// address (leading street number) or a ZIP — bare room/venue names geocode to junk.
const addressish = (venue, address) =>
  /(^|,\s*)\d{2,5}\s+\w/.test(`${venue || ''} ${address || ''}`) || /\b\d{5}\b/.test(`${venue || ''} ${address || ''}`);

// Upcoming (and just-started) events that have coordinates.
const nowIso = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb
    .from('events')
    .select('id, city_id, lat, lng, venue, address')
    .gte('start_at', nowIso)
    .not('lat', 'is', null)
    .range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  rows.push(...(data || []));
  if (!data || data.length < 1000) break;
}

let inside = 0, gated = 0;
const moves = new Map(); // "from->to" -> ids[]
for (const e of rows) {
  const poly = cityAtPoint(e.lat, e.lng);
  if (!poly) continue; // unincorporated / outside all served polygons → keep name-based town
  inside++;
  if (poly === e.city_id || !served.has(poly)) continue;
  // Quality gate: no street address/ZIP → geocode not trustworthy enough to move.
  if (!addressish(e.venue, e.address)) { gated++; continue; }
  // Adjacency gate: real postal-city fixes are neighbors; long moves are junk.
  const from = CENTER[e.city_id], to = CENTER[poly];
  if (from && to && milesBetween(from[0], from[1], to[0], to[1]) > MAX_MOVE_MI) { gated++; continue; }
  const key = `${e.city_id}->${poly}`;
  if (!moves.has(key)) moves.set(key, []);
  moves.get(key).push(e.id);
}

const totalMoves = [...moves.values()].reduce((a, b) => a + b.length, 0);
console.log(`${rows.length} geocoded upcoming events · ${inside} inside a served boundary · ${gated} gated (untrusted geocode) · ${totalMoves} to reassign`);
for (const [key, ids] of [...moves.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${key}: ${ids.length}`);
}

if (DRY || !totalMoves) {
  console.log(DRY ? 'dry run — nothing written' : 'nothing to move.');
  process.exit(0);
}

let updated = 0;
for (const [key, ids] of moves.entries()) {
  const to = key.split('->')[1];
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { error } = await sb.from('events').update({ city_id: to }).in('id', slice);
    if (error) console.error(`  ! ${key}: ${error.message}`);
    else updated += slice.length;
  }
}
console.log(`Done. Reassigned ${updated} event(s) to their true town.`);
