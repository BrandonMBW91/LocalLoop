// Delete aggregator-sourced events more than 60 days past, so the table doesn't
// grow without bound (Jul 2026 audit LOW). User submissions (source_uid IS NULL)
// are ALWAYS preserved. Runs daily from run-all.mjs / CI after ingestion.
//   node retention.mjs            # apply
//   node retention.mjs --dry-run  # count only
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';

loadDotEnv();
const DRY = process.argv.includes('--dry-run');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const cutoff = new Date(Date.now() - 60 * 86400 * 1000).toISOString();

const { count } = await sb
  .from('events')
  .select('id', { count: 'exact', head: true })
  .lt('start_at', cutoff)
  .not('source_uid', 'is', null);

if (DRY) {
  console.log(`Would delete ${count || 0} aggregator event(s) older than 60 days (user submissions preserved).`);
  process.exit(0);
}
if (!count) {
  console.log('Retention: nothing older than 60 days to remove.');
  process.exit(0);
}
const { error } = await sb
  .from('events')
  .delete()
  .lt('start_at', cutoff)
  .not('source_uid', 'is', null);
if (error) { console.error('Retention delete failed:', error.message); process.exit(1); }
console.log(`Retention: removed ${count} aggregator event(s) older than 60 days (user submissions preserved).`);
