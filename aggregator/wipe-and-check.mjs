// One-off maintenance: report duplicate groups, optionally wipe aggregated rows.
//   node wipe-and-check.mjs            # report only (no writes)
//   node wipe-and-check.mjs --wipe     # delete every aggregated row (source_uid not null)
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';

loadDotEnv();
const WIPE = process.argv.includes('--wipe');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function countDuplicates() {
  // Pull aggregated rows in pages and group by content key client-side.
  const key = (r) => `${r.city_id}|${(r.title || '').trim().toLowerCase()}|${r.start_at}`;
  const groups = new Map();
  let from = 0;
  const page = 1000;
  let total = 0;
  for (;;) {
    const { data, error } = await sb
      .from('events')
      .select('id, city_id, title, start_at, source_uid')
      .not('source_uid', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data.length) break;
    total += data.length;
    for (const r of data) {
      const k = key(r);
      groups.set(k, (groups.get(k) || 0) + 1);
    }
    if (data.length < page) break;
    from += page;
  }
  let dupGroups = 0;
  let redundant = 0;
  for (const n of groups.values()) {
    if (n > 1) { dupGroups += 1; redundant += n - 1; }
  }
  return { total, distinct: groups.size, dupGroups, redundant };
}

const before = await countDuplicates();
console.log(`Aggregated rows: ${before.total} | distinct content: ${before.distinct} | dup groups: ${before.dupGroups} | redundant rows: ${before.redundant}`);

if (WIPE) {
  console.log('Wiping all aggregated rows (source_uid not null)…');
  const { error } = await sb.from('events').delete().not('source_uid', 'is', null);
  if (error) { console.error('Delete failed:', error.message); process.exit(1); }
  const after = await countDuplicates();
  console.log(`After wipe — aggregated rows: ${after.total}`);
}
