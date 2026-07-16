// Regenerate src/data/city-coords.js from the Census boundary polygons.
//
// CITY_COORDS powers two user-facing things:
//   - "Use my location" in the town picker (src/lib/nearMe.js): nearest town
//     within 40 miles of the device.
//   - the wrong-town check when posting (src/lib/townFromAddress.js).
// A town missing from it is invisible to BOTH. That is exactly what happened:
// city-coords.js had 130 entries against 135 towns, so Columbus, Cleveland,
// Cincinnati, Newark and New Albany could never be suggested by location — the
// three biggest metros in the catalog. The file said "regenerate when towns are
// added" but nothing regenerated it, so this script is that missing step.
//
//   node build-polygons.mjs        # first: refresh data/city-polygons.json
//   node build-city-coords.mjs     # then: rewrite src/data/city-coords.js
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CITIES } from '../src/data/cities.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const polygons = JSON.parse(readFileSync(join(HERE, 'data', 'city-polygons.json'), 'utf8'));

// Area-weighted centroid of a ring, so a town whose polygon has a long tail
// (river, annexed strip) still centres on its built-up middle rather than being
// dragged into a field. Falls back to the mean vertex for degenerate rings.
function ringCentroid(ring) {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j];
    const [x2, y2] = ring[i];
    const f = x1 * y2 - x2 * y1;
    area += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  area *= 0.5;
  if (!area) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (6 * area), cy / (6 * area)];
}

// Pick the biggest ring (by absolute area) so an outlying island/annex doesn't
// win. Entries look like { name, source, bbox, rings: [[[lng,lat], ...], ...] }.
function biggestRing(geom) {
  const rings = Array.isArray(geom?.rings) ? geom.rings : [];
  let best = null, bestArea = -1;
  for (const r of rings) {
    if (r.length < 3) continue;
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
    a = Math.abs(a / 2);
    if (a > bestArea) { bestArea = a; best = r; }
  }
  return best;
}

const round = (n) => Math.round(n * 1e4) / 1e4;

// MERGE, don't rebuild. An existing town's centroid is left byte-identical: this
// file also drives the wrong-town check when posting (townFromAddress.js), and
// re-deriving everything shifted 11 established towns by 1-1.7 miles (Toledo,
// Akron, Boardman...), which is enough to flip a borderline address between two
// adjacent towns. Only towns with no entry get one.
const existing = new Map(
  [...readFileSync(join(HERE, '..', 'src', 'data', 'city-coords.js'), 'utf8')
    .matchAll(/'([a-z0-9-]+)':\s*\[([-0-9.]+),\s*([-0-9.]+)\]/g)]
    .map((m) => [m[1], `[${m[2]}, ${m[3]}]`]),
);

const lines = [];
const missing = [];
const added = [];
for (const c of CITIES) {
  if (existing.has(c.id)) {
    lines.push(`  '${c.id}': ${existing.get(c.id)},`);
    continue;
  }
  const geom = polygons[c.id];
  const ring = geom && biggestRing(geom);
  if (!ring) { missing.push(c.id); continue; }
  // rings are [lng, lat]; CITY_COORDS is [lat, lng].
  const [lng, lat] = ringCentroid(ring);
  lines.push(`  '${c.id}': [${round(lat)}, ${round(lng)}],`);
  added.push(c.id);
}

const out = `// Town centroids [lat, lng], derived from the Census boundary polygons
// (aggregator/data/city-polygons.json). GENERATED — do not hand-edit.
// Regenerate whenever towns are added:
//   cd aggregator && node build-polygons.mjs && node build-city-coords.mjs
// Consumers: src/lib/nearMe.js ("Use my location" in the picker) and
// src/lib/townFromAddress.js (the wrong-town check when posting). A town missing
// here is invisible to both.
export const CITY_COORDS = {
${lines.join('\n')}
};
`;
writeFileSync(join(HERE, '..', 'src', 'data', 'city-coords.js'), out);
console.log(`src/data/city-coords.js written: ${lines.length}/${CITIES.length} towns`);
console.log(`  added: ${added.length ? added.join(', ') : 'none (already complete)'}`);
if (missing.length) console.log(`  no polygon (skipped): ${missing.join(', ')}`);
