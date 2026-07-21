// One-off + re-runnable maintenance: decode HTML entities and normalize
// typography in already-stored rows. New rows are cleaned on ingest by
// aggregate.mjs; this repairs the backlog. Safe to run repeatedly — it only
// PATCHes rows whose text actually changes.
import fs from 'fs';
import { cleanText, cleanLocation, cleanDescription } from '../src/lib/text.js';

const env = fs.readFileSync(new URL('./.env', import.meta.url), 'utf8');
const get = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : ''; };
const SB = get('SUPABASE_URL'); const KEY = get('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: KEY, authorization: 'Bearer ' + KEY, 'content-type': 'application/json' };

const TABLES = {
  events: { title: cleanText, venue: cleanLocation, address: cleanLocation, description: cleanDescription, host: cleanText },
  garage_sales: { title: cleanText, address: cleanLocation, neighborhood: cleanLocation, items: cleanText, host: cleanText, note: cleanDescription },
  food_trucks: { name: cleanText, location_name: cleanLocation, address: cleanLocation, note: cleanDescription, cuisine: cleanText },
};

async function pullAll(table) {
  let all = []; let from = 0;
  for (;;) {
    const r = await fetch(`${SB}/rest/v1/${table}?select=*&order=created_at.asc&limit=1000&offset=${from}`, { headers: H });
    const b = await r.json();
    if (!Array.isArray(b) || !b.length) break;
    all = all.concat(b); if (b.length < 1000) break; from += 1000;
  }
  return all;
}

// Accepts BOTH spellings on purpose. The repo had scripts taking --dry and others
// taking --dry-run, so typing the wrong one at the wrong script ran it FOR REAL with no
// warning. That happened on 2026-07-21: 'seatgeek.mjs --dry' was a live import.
// Widening the match can only ever make a run more dry, never less.
const DRY = process.argv.includes('--dry-run') || process.argv.includes('--dry');

for (const [table, fields] of Object.entries(TABLES)) {
  const rows = await pullAll(table);
  let changed = 0; const samples = [];
  for (const row of rows) {
    const patch = {};
    for (const [col, fn] of Object.entries(fields)) {
      if (typeof row[col] !== 'string') continue;
      const cleaned = fn(row[col]);
      if (cleaned !== row[col]) patch[col] = cleaned;
    }
    if (Object.keys(patch).length === 0) continue;
    changed++;
    if (samples.length < 4) samples.push({ before: Object.fromEntries(Object.keys(patch).map((k) => [k, String(row[k]).slice(0, 55)])), after: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v).slice(0, 55)])) });
    if (!DRY) {
      const r = await fetch(`${SB}/rest/v1/${table}?id=eq.${row.id}`, { method: 'PATCH', headers: H, body: JSON.stringify(patch) });
      if (!r.ok) { console.error(`  PATCH fail ${table} ${row.id}`, r.status, await r.text()); }
    }
  }
  console.log(`${table}: ${rows.length} rows, ${changed} ${DRY ? 'WOULD change' : 'cleaned'}`);
  samples.forEach((s) => console.log('   ', JSON.stringify(s.before), '->', JSON.stringify(s.after)));
}
console.log(DRY ? 'dry run complete' : 'done');
