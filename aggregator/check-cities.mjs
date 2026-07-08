// Pre-flight consistency check for the city config. Run it right after adding a
// town (or any time) to catch the silent-failure class where a town exists in one
// place but not another and so quietly ingests/routes/renders nothing:
//
//   node check-cities.mjs
//
// It cross-checks the three places a town has to line up:
//   1) src/data/cities.js  CITIES        — the app + website picker
//   2) aggregator/towns.mjs NAMES        — the address->town matcher
//   3) src/data/cities.js  REGION_ORDER  — the section a town's region lives in
// and verifies the NAMES ordering invariant (a shorter name that is a trailing
// word of a longer one must be listed AFTER it, or it steals the longer town's
// events — e.g. "Canton" must not precede "North Canton").
//
// Exit code 1 on any hard problem so it can gate a commit/CI if you want.
// It does NOT touch the database; it's a pure static check with no secrets.
import { CITIES, REGION_ORDER } from '../src/data/cities.js';
import { NAMES } from './towns.mjs';

let problems = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); problems++; };

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cityIds = new Set(CITIES.map((c) => c.id));
const nameIds = NAMES.map(([id]) => id);
const nameIdSet = new Set(nameIds);

// 1) Every picker city needs a matcher, or its events are never assigned to it.
for (const c of CITIES) {
  if (!nameIdSet.has(c.id)) {
    fail(`"${c.id}" is in CITIES but missing from towns.mjs NAMES — events will never route to it (ghost town)`);
  }
  if (!REGION_ORDER.includes(c.region)) {
    fail(`"${c.id}" has region "${c.region}" which is not in REGION_ORDER — it won't render in a section`);
  }
}

// 2) Every matcher id must be a real city, or it matches into nowhere.
for (const id of nameIds) {
  if (!cityIds.has(id)) fail(`"${id}" is in towns.mjs NAMES but not in CITIES — orphan matcher`);
}

// 3) Duplicate ids in either list.
const dups = (arr) => [...new Set(arr.filter((v, i) => arr.indexOf(v) !== i))];
for (const d of dups(CITIES.map((c) => c.id))) fail(`duplicate CITIES id: "${d}"`);
for (const d of dups(nameIds)) fail(`duplicate NAMES id: "${d}"`);

// 4) Ordering invariant: if display name A is a trailing whole-word of display
//    name B (B is longer), then B must appear BEFORE A in NAMES, or A shadows B.
for (let i = 0; i < NAMES.length; i++) {
  const short = NAMES[i][1];
  const shortRe = new RegExp(`(?:^|\\s)${esc(short)}$`, 'i');
  for (let j = i + 1; j < NAMES.length; j++) {
    const long = NAMES[j][1];
    if (long.length > short.length && shortRe.test(long)) {
      fail(`NAMES ordering: "${short}" is listed before "${long}" — the shorter name will steal "${long}" events. Move "${long}" above "${short}".`);
    }
  }
}

const total = CITIES.length;
const regions = REGION_ORDER.map((r) => `${r}: ${CITIES.filter((c) => c.region === r).length}`).join(' | ');
if (problems) {
  console.error(`\n⚠ ${problems} problem(s) found across ${total} towns.`);
  process.exit(1);
}
console.log(`✔ city config consistent — ${total} towns, ${nameIds.length} matchers.`);
console.log(`  ${regions}`);
