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
const WEBHOOK_FILE = join(ROOT, 'supabase', 'functions', 'stripe-webhook', 'index.ts');

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

// Webhook CATALOG_CITY_IDS: the edge function bakes its own town list (edge fns
// can't import src). Without the new id here, a purchase from the town falls to the
// manual owner-email path instead of fanning out. Order is irrelevant (it becomes a
// Set), so we append before the array's closing `];`. Returns a plan so --dry-run can
// preview it and the real run can apply + report it.
function webhookCatalogPlan() {
  let src;
  try { src = readFileSync(WEBHOOK_FILE, 'utf8'); }
  catch { return { msg: '… webhook source not found — skipping CATALOG_CITY_IDS (add "' + id + '" by hand)' }; }
  const start = src.indexOf('const CATALOG_CITY_IDS = [');
  // Match the line break BEFORE `];` including a CR, so `end` lands on the start of
  // the break rather than on the LF. This file is CRLF: the old `indexOf('\n];')`
  // pointed at the LF and left the CR inside slice(0, end), so appending a comma
  // produced `// added by add-city.mjs\r,`. A bare CR is a JS line terminator, which
  // ENDS the comment — so that comma became a real array separator and left an
  // elision. The resulting `undefined` element reached codeToCity's id.replace() and
  // threw, making the webhook 500 on EVERY checkout.session.completed. Payments were
  // dead from that moment (found 2026-07-21 by replaying a signed event).
  const brk = start === -1 ? null : /\r?\n\];/.exec(src.slice(start));
  const end = brk ? start + brk.index : -1;
  if (end === -1) return { msg: `⚠ could not locate CATALOG_CITY_IDS array — add '${id}' to the webhook by hand` };
  if (new RegExp(`'${reEsc(id)}'`).test(src.slice(start, end))) return { msg: `✓ webhook CATALOG_CITY_IDS already lists "${id}"` };
  // Add the separating comma only if the last ELEMENT lacks one. Strip line comments
  // first: every entry here ends `// added by add-city.mjs`, so the old bare
  // `/,\s*$/` never matched and this appended a stray comma on every single run.
  const lastCode = src.slice(start, end).replace(/\/\/[^\r\n]*/g, '').trimEnd();
  const needsComma = !/,$/.test(lastCode);
  const next = `${src.slice(0, end)}${needsComma ? ',' : ''}\n  '${id}', // added by add-city.mjs${src.slice(end)}`;
  return {
    msg: `✓ added "${id}" to webhook CATALOG_CITY_IDS — REDEPLOY the function to apply (supabase functions deploy stripe-webhook)`,
    write: () => writeFileSync(WEBHOOK_FILE, next),
  };
}

const cov = lat && lng ? anchorFor(Number(lat), Number(lng)) : undefined;
const covMsg = cov === undefined
  ? '… no --lat/--lng — anchor coverage unchecked (add coords to verify ticketed coverage)'
  : cov
    ? `✓ inside anchor "${cov.anchor.name}" (${cov.miles.toFixed(1)}mi) — ticketed events turnkey, no new anchor needed`
    : '⚠ NOT inside any anchor — add a NEW anchor to geo.mjs or this town gets ZERO ticketed events';

if (DRY) {
  const wh = webhookCatalogPlan();
  console.log('DRY RUN — nothing written.\n');
  console.log(`cities.js  (after line ${cAt + 1}):\n${citiesEntry}\n`);
  console.log(`towns.mjs  (before line ${tAt + 1}):\n${namesEntry}\n`);
  console.log(wh.msg);
  console.log(covMsg);
  process.exit(0);
}

cLines.splice(cAt + 1, 0, citiesEntry);
writeFileSync(CITIES_FILE, cLines.join('\n'));
tLines.splice(tAt, 0, namesEntry);
writeFileSync(TOWNS_FILE, tLines.join('\n'));
const wh = webhookCatalogPlan();
if (wh.write) wh.write();
console.log(`✓ inserted "${id}" into cities.js (${region}) and towns.mjs NAMES`);
console.log(wh.msg);
console.log(covMsg);

console.log('\n── check-cities ──');
try { execSync('node check-cities.mjs', { stdio: 'inherit', cwd: AGG }); }
catch { die('check-cities failed — review the config above'); }

console.log(`\nNext (see docs/NEW_CITY.md) — auto-done above: cities.js, towns.mjs, webhook catalog.
  1. Wire a feed for "${id}"  (event_sources iCal/jsonld row OR librarymarket.mjs LIBS)
  2. node build-polygons.mjs     # add "${id}" boundary polygon (geocode assignment)
  3. node build-city-coords.mjs  # add "${id}" to src/data/city-coords.js — WITHOUT this,
                                 # "Use my location" can never suggest "${id}" and the
                                 # post-time wrong-town check ignores it (this step was
                                 # missing, which left Columbus/Cleveland/Cincinnati
                                 # coordinate-less for weeks). Merge-only: it never moves
                                 # an existing town.
  4. node run-all.mjs            # aggregate + build pages
  5. node check-content.mjs      # confirm "${id}" has events (not a ghost town)
  6. supabase functions deploy stripe-webhook --project-ref wtaefyspddadcrnovumk --no-verify-jwt
                                 # ships the CATALOG_CITY_IDS add so ad purchases fan out
  7. cd ../scripts && STRIPE_SECRET_KEY=sk_live_... node stripe-refresh-towns.mjs --apply
                                 # adds "${id}" to the Stripe checkout town dropdowns
  8. bump src/version.js BUILD, then: npx eas update --branch production
                                 # the picker + coords ship in the JS bundle, so a new
                                 # town is invisible in the app until an OTA
  9. git commit + push           # CI regenerates + deploys the website`);
