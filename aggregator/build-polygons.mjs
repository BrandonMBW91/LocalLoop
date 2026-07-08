// Build data/city-polygons.json — official Census TIGER boundary polygons for
// every picker town. Run once after changing the town list:
//   node build-polygons.mjs
// Sources (live-verified): TIGERweb ArcGIS REST, current vintage —
//   layer 4 = Incorporated Places (cities/villages)
//   layer 5 = Census Designated Places (Austintown, Portage Lakes)
//   layer 1 = County Subdivisions (townships: Catawba Island, Boardman — Boardman
//             is NOT a CDP in TIGERweb, verified)
// Queries use BASENAME (NAME carries a suffix like "Findlay city"); homonym hits
// are disambiguated by nearest metro anchor. maxAllowableOffset trims polygons to
// a few KB while keeping clean town outlines.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CITIES } from '../src/data/cities.js';
import { ANCHORS, milesBetween } from './geo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'data', 'city-polygons.json');
const BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer';
const UA = { 'User-Agent': 'Mozilla/5.0 (LocalLoop aggregator)' };

// Towns that need a specific layer/GEOID (unincorporated or missing from Places).
const OVERRIDES = {
  boardman: { layer: 1, geoid: '3909907468' },        // Boardman township (no CDP exists)
  austintown: { layer: 5, geoid: '3903184' },          // Austintown CDP
  'portage-lakes': { layer: 5, geoid: '3964136' },     // Portage Lakes CDP
  'catawba-island': { layer: 1, geoid: '3912312588' }, // Catawba Island township
};
// Census spells some names differently than we do.
const NAME_ALIASES = { larue: ['LaRue', 'La Rue'] };

async function query(layer, where) {
  const url =
    `${BASE}/${layer}/query?where=${encodeURIComponent(where)}` +
    `&outFields=NAME,BASENAME,GEOID,LSADC,CENTLAT,CENTLON&returnGeometry=true` +
    `&outSR=4326&maxAllowableOffset=0.0008&geometryPrecision=5&f=geojson`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.features || [];
}

// Outer rings only (holes at town scale are enclave places, handled by
// citypoly's smallest-polygon-wins rule).
function ringsOf(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates[0]];
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((p) => p[0]);
  return [];
}

function bboxOf(rings) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return [w, s, e, n].map((v) => Math.round(v * 1e5) / 1e5);
}

// Homonym tie-break: the feature nearest to any of our metro anchors wins.
function nearestToAnchors(features) {
  const score = (f) => {
    const lat = Number(f.properties.CENTLAT), lng = Number(f.properties.CENTLON);
    return Math.min(...ANCHORS.map((a) => milesBetween(lat, lng, a.lat, a.lng)));
  };
  return features.slice().sort((a, b) => score(a) - score(b))[0];
}

const out = {};
const missing = [];
for (const c of CITIES) {
  let feature = null, source = '';
  try {
    const ov = OVERRIDES[c.id];
    if (ov) {
      const feats = await query(ov.layer, `GEOID='${ov.geoid}'`);
      feature = feats[0];
      source = `layer ${ov.layer} GEOID ${ov.geoid}`;
    } else {
      const names = NAME_ALIASES[c.id] || [c.name];
      for (const nm of names) {
        // Places first (cities/villages), CDP fallback.
        for (const layer of [4, 5]) {
          const feats = await query(layer, `STATE='39' AND BASENAME='${nm.replace(/'/g, "''")}'`);
          if (feats.length) {
            feature = feats.length > 1 ? nearestToAnchors(feats) : feats[0];
            source = `layer ${layer} ${feature.properties.NAME} GEOID ${feature.properties.GEOID}${feats.length > 1 ? ' (nearest of ' + feats.length + ')' : ''}`;
            break;
          }
        }
        if (feature) break;
      }
    }
  } catch (e) {
    console.error(`  ! ${c.id}: ${e.message}`);
  }
  if (!feature) { missing.push(c.id); console.log(`  ✗ ${c.id} — no boundary found`); continue; }
  const rings = ringsOf(feature.geometry).map((ring) => ring.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]));
  if (!rings.length) { missing.push(c.id); console.log(`  ✗ ${c.id} — empty geometry`); continue; }
  out[c.id] = { name: c.name, source, bbox: bboxOf(rings), rings };
  console.log(`  ✓ ${c.id} — ${source} (${rings.reduce((a, r) => a + r.length, 0)} verts)`);
  await new Promise((r) => setTimeout(r, 120)); // be polite to TIGERweb
}

writeFileSync(OUT, JSON.stringify(out));
const kb = Math.round(JSON.stringify(out).length / 1024);
console.log(`\n${Object.keys(out).length}/${CITIES.length} towns → data/city-polygons.json (${kb} KB)`);
if (missing.length) console.log(`missing: ${missing.join(', ')}`);
