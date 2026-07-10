// Scaffold a new city in ONE guarded command instead of hand-editing several files.
// Validates the id/region, warns on name collisions, inserts the CITIES row and the
// towns.mjs NAMES matcher (in a collision-safe position), reports anchor coverage,
// and runs check-cities. It does NOT wire feeds (those are per-town) — it prints the
// remaining steps.
//
//   node add-city.mjs --id=port-clinton --name="Port Clinton" --region="Northwest Ohio" \
//        --tagline="Walleye Capital of the World" --lat=41.512 --lng=-82.938
//   node add-city.mjs ... --dry-run     # print what it would do, write nothing
//   node add-city.mjs ... --force       # proceed despite a collision warning
//
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { CITIES, REGION_ORDER } from '../src/data/cities.js';
import { NAMES } from './towns.mjs';
import { anchorFor } from './geo.mjs';

const AGG = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(AGG);
const CITIES_FILE = join(ROOT, 'src', 'data', 'cities.js');
const TOWNS_FILE = join(AGG, 'towns.mjs');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const r = a.replace(/^--/, '');
    const i = r.indexOf('=');
    return i === -1 ? [r, true] : [r.slice(0, i), r.slice(i + 1)];
  })
);
const { id, name, region, tagline = '', lat, lng } = args;
const DRY = Boolean(args['dry-run']);
const FORCE = Boolean(args.force);
const die = (m) => { console.error('✗ ' + m); process.exit(1); };
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

if (!id || !name || !region) die('need --id, --name, --region (and ideally --tagline, --lat, --lng)');
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) die(`id "${id}" must be kebab-case (lowercase / digits / hyphens)`);
if (!REGION_ORDER.includes(region)) die(`region "${region}" is not in REGION_ORDER: ${REGION_ORDER.join(', ')}`);
if (CITIES.some((c) => c.id === id)) die(`id "${id}" already exists in CITIES`);

const REGION_CONST = { 'Northwest Ohio': 'NW', 'Central Ohio': 'CENTRAL', 'Northeast Ohio': 'NE', 'Southeast Ohio': 'SE', 'Southwest Ohio': 'SW' }[region];
if (!REGION_CONST) die(`no cities.js region const mapped for "${region}" — edit cities.js by hand`);

// Collision warning: existing matcher name that is a trailing whole-word of the new
// name, or vice-versa (the exact hazard check-cities' ordering rule guards).
const collisions = NAMES.filter(([, n]) => {
  if (n.length === name.length) return false;
  const [shortN, longN] = n.length < name.length ? [n, name] : [name, n];
  return new RegExp(`(?:^|\\s)${reEsc(shortN)}$`, 'i').test(longN);
}).map(([, n]) => n);
if (collisions.length) {
  console.error(`⚠ "${name}" collides (trailing-word) with existing town(s): ${collisions.join(', ')}. Scaffold will order NAMES to compensate; verify with check-cities.${FORCE ? '' : '  (--force to silence)'}`);
  if (!FORCE && !DRY) die('stopping — re-run with --force once you have reviewed the collision');
}

const citiesEntry = `  { id: '${id}', name: ${JSON.stringify(name)}, state: 'OH', region: ${REGION_CONST}, tagline: ${JSON.stringify(tagline)} },`;
const namesEntry = `  ['${id}', ${JSON.stringify(name)}],`;

// cities.js: insert right after the LAST existing entry of the same region const.
const cLines = readFileSync(CITIES_FILE, 'utf8').split('\n');
let cAt = -1;
for (let i = 0; i < cLines.length; i++) if (new RegExp(`region:\\s*${REGION_CONST}\\b`).test(cLines[i])) cAt = i;
if (cAt === -1) {
  // First town of a brand-new region: anchor on the CITIES array's closing `];`
  // (a `// --- <region> ---` section comment is cosmetic; the picker groups by
  // the region field, not by file order).
  const open = cLines.findIndex((l) => l.startsWith('export const CITIES'));
  for (let i = open + 1; i < cLines.length; i++) if (/^\];/.test(cLines[i])) { cAt = i - 1; break; }
}
if (cAt === -1) die(`could not find an existing ${REGION_CONST} row in cities.js to anchor the insert`);

// towns.mjs: put the new matcher BEFORE the earliest existing name that is a shorter
// trailing-word of it (so the longer new name wins), else append before NAMES' `];`.
const shorterTrailing = NAMES.filter(([, n]) => n.length < name.length && new RegExp(`(?:^|\\s)${reEsc(n)}$`, 'i').test(name)).map(([, n]) => n);
const tLines = readFileSync(TOWNS_FILE, 'utf8').split('\n');
let tAt = -1;
if (shorterTrailing.length) {
  for (let i = 0; i < tLines.length; i++) {
    if (shorterTrailing.some((sn) => new RegExp(`,\\s*${reEsc(JSON.stringify(sn))}\\s*\\]`).test(tLines[i]))) { tAt = i; break; }
  }
}
if (tAt === -1) {
  const decl = tLines.findIndex((l) => /export const NAMES\s*=\s*\[/.test(l));
  for (let i = decl; i < tLines.length; i++) if (/^\s*\];/.test(tLines[i])) { tAt = i; break; }
}

const cov = lat && lng ? anchorFor(Number(lat), Number(lng)) : undefined;
const covMsg = cov === undefined
  ? '… no --lat/--lng — anchor coverage unchecked (add coords to verify ticketed coverage)'
  : cov
    ? `✓ inside anchor "${cov.anchor.name}" (${cov.miles.toFixed(1)}mi) — ticketed events turnkey, no new anchor needed`
    : '⚠ NOT inside any anchor — add a NEW anchor to geo.mjs or this town gets ZERO ticketed events';

if (DRY) {
  console.log('DRY RUN — nothing written.\n');
  console.log(`cities.js  (after line ${cAt + 1}):\n${citiesEntry}\n`);
  console.log(`towns.mjs  (before line ${tAt + 1}):\n${namesEntry}\n`);
  console.log(covMsg);
  process.exit(0);
}

cLines.splice(cAt + 1, 0, citiesEntry);
writeFileSync(CITIES_FILE, cLines.join('\n'));
tLines.splice(tAt, 0, namesEntry);
writeFileSync(TOWNS_FILE, tLines.join('\n'));
console.log(`✓ inserted "${id}" into cities.js (${region}) and towns.mjs NAMES`);
console.log(covMsg);

console.log('\n── check-cities ──');
try { execSync('node check-cities.mjs', { stdio: 'inherit', cwd: AGG }); }
catch { die('check-cities failed — review the config above'); }

console.log(`\nNext (see docs/NEW_CITY.md):
  1. Wire a feed for "${id}"  (event_sources iCal/jsonld row OR librarymarket.mjs LIBS)
  2. node run-all.mjs            # aggregate + build pages
  3. node check-content.mjs      # confirm "${id}" has events (not a ghost town)
  4. bump src/version.js BUILD, then: npx eas update --branch production
  5. git commit + push           # CI regenerates + deploys the website`);
