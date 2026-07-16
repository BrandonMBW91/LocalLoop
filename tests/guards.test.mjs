// Invariant guards: the rules this codebase has ALREADY broken, encoded so they
// cannot break the same way twice. Run: node tests/guards.test.mjs
//
// These are not unit tests. Each one exists because a real outage or a real money bug
// got past review, and a grep would have caught it. When one fails, do not "fix the
// test" — you are about to ship the thing it is named after.
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLinkUrl } from '../src/lib/links.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('  FAIL:', name, '\n         ', e.message); } };

// Walk the app's on-device source. Only src/ and app/ ship to phones; scripts/ and
// aggregator/ run on Node where Intl is fine, so they are deliberately excluded.
function appSources() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue; }
      if (['.js', '.jsx', '.ts', '.tsx'].includes(extname(name))) out.push(p);
    }
  };
  walk(join(ROOT, 'src'));
  walk(join(ROOT, 'app'));
  return out;
}
const rel = (p) => p.slice(ROOT.length + 1).replace(/\\/g, '/');
// Strip comments so a rule can be *described* in prose without tripping its own guard.
const code = (p) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// --- GUARD 1: no Intl on-device ------------------------------------------------
// Hermes's Android Intl backend has returned WRONG values in this app: a Wednesday
// rendered as "Thursday" (da39608). A divergence audit closed 2026-07-08 declaring
// "ZERO Intl/toLocale* calls remain on-device" — and 61de69a reintroduced one five
// days later on the welcome screen, the first thing a new user sees. Twice is a
// pattern, so it gets a guard. Use the helpers in src/utils/dates.js instead.
t('no Intl / toLocale* in on-device code (Hermes Android renders it wrong)', () => {
  const bad = [];
  for (const f of appSources()) {
    const src = code(f);
    for (const m of src.matchAll(/\b(Intl\.\w+|toLocaleString|toLocaleDateString|toLocaleTimeString)\s*\(/g)) {
      bad.push(`${rel(f)}: ${m[1]}()`);
    }
  }
  assert.equal(bad.length, 0, `Intl is unreliable under Hermes on Android. Use src/utils/dates.js (formatCount, calendarBits, nyHour...).\n          ${bad.join('\n          ')}`);
});

// --- GUARD 2: removeClippedSubviews stays off ----------------------------------
// Enabled as an Android "list perf" tweak on 2026-07-11 (d857538). Under the New
// Architecture (Fabric, default since SDK 54) view clipping desyncs the shadow tree
// from the real view tree, and Android died on EVERY launch with
// "IllegalStateException: addViewAt: failed to insert view into parent". It shipped by
// OTA and testers were broken for five days. iOS never showed it.
t('removeClippedSubviews is never enabled (fatal under Fabric on Android)', () => {
  const bad = [];
  for (const f of appSources()) {
    for (const m of code(f).matchAll(/removeClippedSubviews\s*=\s*\{?([^}\n]*)/g)) {
      const v = m[1].trim();
      if (!/^\{?false\}?$/.test(v.replace(/[{}]/g, ''))) bad.push(`${rel(f)}: removeClippedSubviews={${v}}`);
    }
  }
  assert.equal(bad.length, 0, `Must stay false — it crashes every Android launch under Fabric.\n          ${bad.join('\n          ')}`);
});

// --- GUARD 3: sponsors/deals are never SELECT * --------------------------------
// sponsors has 19 columns but `authenticated` may read 15 — the stripe_* ones are
// deliberately withheld. A bare .select() means SELECT *, touches them, 403s, and on an
// insert rolls the row back. Creating an ad or a deal failed EVERY time until 2026-07-16.
t('sponsors/deals never use a bare .select() (403s on the withheld stripe_* columns)', () => {
  // code(), not readFileSync: the comments in db.js explaining this very rule contain
  // the literal string ".select()", and a raw read makes the guard flag its own prose.
  const db = code(join(ROOT, 'src/lib/db.js'));
  const bad = [];
  // Find each .from('sponsors'|'deals') and check the select that follows it.
  for (const m of db.matchAll(/\.from\(['"](sponsors|deals)['"]\)([\s\S]{0,600}?)\.select\(([^)]*)\)/g)) {
    const arg = m[3].trim();
    if (!arg) bad.push(`.from('${m[1]}') ... .select()  <- bare, means SELECT *`);
  }
  assert.equal(bad.length, 0, `Use SPONSOR_ADMIN_COLS / DEAL_COLS.\n          ${bad.join('\n          ')}`);
});

// --- GUARD 4: exactly one moderate_submission ----------------------------------
// It was defined in SEVEN .sql files with different bodies and no migration runner. On
// 2026-07-16 a fix built from a stale copy would have silently reverted the 2026-07-11
// source_uid security fix and every length cap.
t('moderate_submission is defined in exactly one file', () => {
  const dir = join(ROOT, 'supabase');
  const defs = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => /create\s+(or\s+replace\s+)?function\s+public\.moderate_submission/i.test(readFileSync(join(dir, f), 'utf8')));
  assert.deepEqual(defs, ['moderate_submission.sql'],
    `Exactly one file may define it, and it must be the authoritative one.\n          found: ${defs.join(', ') || '(none!)'}`);
});

// --- GUARD 5: the deploy target is pinned --------------------------------------
// `netlify status` in this repo resolved to nwosecurity -> nwohiosecurity.com, because a
// stray .netlify/state.json sat in the PARENT folder and the CLI walks up the tree. The
// documented deploy command would have published Local Loop over another live business.
t('deploy:web pins --site (a parent-folder link once aimed this repo at another business)', () => {
  const s = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts['deploy:web'] || '';
  assert.match(s, /--site\s+ecb90ea6-5f53-4846-ad52-31cb726b5f52/,
    'deploy:web must pin the local-loop site id; config alone is not enough (.netlify/ is gitignored).');
});

// --- normalizeLinkUrl ----------------------------------------------------------
// An advertiser types "joespizza.com". Stored raw the paid banner's tap is dead while
// clicks still counts it, so the CTR reported back to them counts taps that never landed.
const linkCases = [
  ['joespizza.com', 'https://joespizza.com'],
  ['  joespizza.com  ', 'https://joespizza.com'],
  ['www.joespizza.com', 'https://www.joespizza.com'],
  ['https://joespizza.com', 'https://joespizza.com'],
  ['http://joespizza.com', 'http://joespizza.com'],
  ['joespizza.com/menu?x=1', 'https://joespizza.com/menu?x=1'],
  ['sub.domain.co.uk', 'https://sub.domain.co.uk'],
  ['tel:5551234567', 'tel:5551234567'],
  ['mailto:joe@pizza.com', 'mailto:joe@pizza.com'],
  ['javascript:alert(1)', null],
  ['localhost:3000', null],
  ['call us', null],
  ['joespizza', null],
  ['', ''],
  [null, ''],
];
for (const [input, expected] of linkCases) {
  t(`normalizeLinkUrl(${JSON.stringify(input)}) -> ${JSON.stringify(expected)}`, () => {
    assert.equal(normalizeLinkUrl(input), expected);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
