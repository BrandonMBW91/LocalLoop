// True city lines: point-in-polygon lookups against official Census TIGER
// boundaries (incorporated places, CDPs like Boardman/Austintown/Portage Lakes,
// and townships like Catawba Island). The polygons live in
// data/city-polygons.json, built once per town-list change by build-polygons.mjs.
//
// This is what "which town is this event actually in" should mean — the town
// whose municipal boundary contains the event's coordinates — instead of trusting
// the postal city in the address (Boardman events say "Youngstown, OH 44512").
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const POLY_FILE = join(HERE, 'data', 'city-polygons.json');

// data/city-polygons.json shape (built by build-polygons.mjs):
//   { "<city-id>": { name, source, bbox: [w,s,e,n], rings: [ [ [lng,lat], ... ], ... ] } }
// `rings` is a flat list of outer rings (multipolygon parts). Holes are rare at
// town scale and deliberately ignored — a hole in a city polygon is almost always
// another (enclave) place, which wins by being checked as its own town first.
let TOWNS = null;
export function loadPolygons() {
  if (TOWNS) return TOWNS;
  try {
    const raw = JSON.parse(readFileSync(POLY_FILE, 'utf8'));
    TOWNS = Object.entries(raw).map(([id, t]) => ({ id, ...t }));
  } catch {
    TOWNS = []; // no polygon file yet — callers degrade to name-based assignment
  }
  return TOWNS;
}

// Ray-casting point-in-ring. lng/lat order matches GeoJSON.
function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// The town whose official boundary contains this point, or null when the point
// is in unincorporated space / outside every served town. Enclave rule: if two
// towns' polygons both claim the point (an enclave village inside a township),
// the SMALLER polygon wins — it's the more specific place.
export function cityAtPoint(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best = null;
  for (const t of loadPolygons()) {
    const [w, s, e, n] = t.bbox;
    if (lng < w || lng > e || lat < s || lat > n) continue;
    if (t.rings.some((ring) => inRing(lng, lat, ring))) {
      if (!best || area2(t) < area2(best)) best = t;
    }
  }
  return best ? best.id : null;
}

// Cheap comparative size (bbox area) — only used to break enclave ties.
function area2(t) {
  const [w, s, e, n] = t.bbox;
  return (e - w) * (n - s);
}

// Diagnostics for check-cities / build-polygons: which picker towns lack a polygon.
export function polygonCoverage(cityIds) {
  const have = new Set(loadPolygons().map((t) => t.id));
  return { have, missing: cityIds.filter((id) => !have.has(id)) };
}
