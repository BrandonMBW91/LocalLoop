// Bulk-add verified event_sources rows produced by the coverage-expansion workflow.
//   node add-feeds.mjs <path-to-confirmed.json> [--apply]
// confirmed.json = [{city_id, name, type, url, category, futureEvents, evidence}, ...]
// Without --apply it's a DRY RUN (prints what it would add). With --apply it inserts
// rows as enabled + approved so the next aggregate run pulls them. Dedupes against
// existing sources by normalized URL and skips city_ids that aren't real towns.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';

loadDotEnv();
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const path = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!path) { console.error('usage: node add-feeds.mjs <confirmed.json> [--apply]'); process.exit(1); }

const wanted = JSON.parse(readFileSync(path, 'utf8'));
const norm = (u) => String(u || '').trim().replace(/\/+$/, '').replace(/^https?:\/\//, '').toLowerCase();

const { data: existing, error: e1 } = await sb.from('event_sources').select('city_id,name,url,type');
if (e1) { console.error(e1.message); process.exit(1); }
const existingUrls = new Set(existing.map((s) => norm(s.url)));

// Valid town ids (guard against an agent inventing a city_id).
const { CITIES } = await import('../src/data/cities.js');
const validCity = new Set(CITIES.map((c) => c.id));
const okType = new Set(['ical', 'jsonld', 'communico', 'simpleview', 'librarymarket', 'bibliocommons', 'revize']);
const okCat = new Set(['Community', 'Arts', 'Music', 'Family', 'Education', 'Market', 'Sports', 'Food']);

const toAdd = [];
const skipped = [];
const seenThisRun = new Set();
for (const f of wanted) {
  const url = String(f.url || '').trim();
  const reason =
    !validCity.has(f.city_id) ? `unknown city_id ${f.city_id}`
    : !okType.has(f.type) ? `bad type ${f.type}`
    : !/^https?:\/\//.test(url) ? 'not an http url'
    : existingUrls.has(norm(url)) ? 'already have this url'
    : seenThisRun.has(norm(url)) ? 'dup within this batch'
    : null;
  if (reason) { skipped.push({ ...f, reason }); continue; }
  seenThisRun.add(norm(url));
  toAdd.push({
    city_id: f.city_id,
    name: String(f.name).slice(0, 120),
    type: f.type,
    url,
    default_category: okCat.has(f.category) ? f.category : 'Community',
    enabled: true,
    status: 'approved',
  });
}

console.log(`${wanted.length} candidate(s): ${toAdd.length} to add, ${skipped.length} skipped.\n`);
const byCity = {};
for (const a of toAdd) (byCity[a.city_id] = byCity[a.city_id] || []).push(a);
for (const [c, list] of Object.entries(byCity).sort()) {
  console.log(`  ${c} (+${list.length}): ${list.map((x) => `${x.name} [${x.type}]`).join(', ')}`);
}
if (skipped.length) {
  console.log('\nskipped:');
  const byReason = {};
  for (const s of skipped) (byReason[s.reason] = byReason[s.reason] || 0, byReason[s.reason]++);
  for (const [r, n] of Object.entries(byReason)) console.log(`  ${n}x ${r}`);
}

if (!APPLY) { console.log('\nDRY RUN — re-run with --apply to insert.'); process.exit(0); }
if (!toAdd.length) { console.log('\nNothing to add.'); process.exit(0); }
const { data, error } = await sb.from('event_sources').insert(toAdd).select('id,city_id,name');
if (error) { console.error('insert failed:', error.message); process.exit(1); }
console.log(`\nInserted ${data.length} event source(s). Next aggregate run pulls them.`);
