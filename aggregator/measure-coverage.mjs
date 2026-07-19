// Compare current per-town approved-upcoming event counts against the baseline
// snapshot captured before today's aggregator work (scratchpad/town-coverage.json).
//   node measure-coverage.mjs
import { readFileSync } from 'node:fs';

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const t = read('../.env') + '\n' + read('.env');
const g = (k) => (new RegExp('^' + k + '=(.*)$', 'm').exec(t) || [])[1]?.trim();
const SB = g('EXPO_PUBLIC_SUPABASE_URL') || g('SUPABASE_URL'), KEY = g('SUPABASE_SERVICE_ROLE_KEY');
const q = async (p) => (await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();

const BASE = 'C:/Users/micha/AppData/Local/Temp/claude/C--Users-micha-New/2c81f934-1661-4ca6-99eb-a00472adbbbe/scratchpad/town-coverage.json';
const baseline = JSON.parse(readFileSync(BASE, 'utf8')); // [{id,name,events}]
const before = new Map(baseline.map((t) => [t.id, t.events]));

const now = new Date().toISOString();
let rows = [], from = 0;
for (;;) { const p = await q(`events?select=city_id&status=eq.approved&start_at=gte.${now}&limit=1000&offset=${from}`); rows = rows.concat(p); if (p.length < 1000) break; from += 1000; }
const after = {};
rows.forEach((e) => { after[e.city_id] = (after[e.city_id] || 0) + 1; });

const { CITIES } = await import('../src/data/cities.js');
const nameOf = new Map(CITIES.map((c) => [c.id, c.name]));

const diffs = [];
let totBefore = 0, totAfter = 0, liftedZero = 0;
for (const id of new Set([...before.keys(), ...Object.keys(after)])) {
  const b = before.get(id) || 0, a = after[id] || 0;
  totBefore += b; totAfter += a;
  if (b === 0 && a > 0) liftedZero++;
  diffs.push({ id, name: nameOf.get(id) || id, b, a, d: a - b });
}
diffs.sort((x, y) => y.d - x.d);

console.log(`\n=== COVERAGE BEFORE / AFTER ===`);
console.log(`total upcoming events: ${totBefore}  ->  ${totAfter}   (+${totAfter - totBefore}, ${((totAfter / totBefore - 1) * 100).toFixed(0)}%)`);
console.log(`towns lifted off ZERO: ${liftedZero}`);
console.log(`towns with any gain: ${diffs.filter((x) => x.d > 0).length} / ${diffs.length}`);
console.log(`towns that LOST events: ${diffs.filter((x) => x.d < 0).length}  (dedup/stale cleanup)`);

console.log(`\n--- top 25 gainers ---`);
diffs.slice(0, 25).forEach((x) => console.log(`  +${String(x.d).padStart(4)}   ${x.name.padEnd(24)} ${x.b} -> ${x.a}`));

console.log(`\n--- previously-zero towns, now ---`);
const zeros = baseline.filter((t) => t.events === 0).map((t) => t.id);
zeros.forEach((id) => { const x = diffs.find((d) => d.id === id); if (x) console.log(`  ${x.name.padEnd(24)} 0 -> ${x.a}${x.a === 0 ? '   (still empty)' : ''}`); });

console.log(`\n--- any town that LOST events (investigate if large) ---`);
diffs.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 15).forEach((x) => console.log(`  ${String(x.d).padStart(5)}   ${x.name.padEnd(24)} ${x.b} -> ${x.a}`));
