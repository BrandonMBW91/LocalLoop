// One-time (or occasional) re-labeling of events already in the database with
// Claude, replacing the coarse source-default categories (everything from a
// library was "Community", etc.) with proper ones the filter chips use.
//
// Usage:
//   node categorize.mjs            # re-label all aggregated (feed) events
//   node categorize.mjs --all      # re-label EVERY event, including hand-added
//   node categorize.mjs --dry-run  # show proposed labels, write nothing
//
// Env (from aggregator/.env or the shell): SUPABASE_URL,
//   SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { classifyEvents, emojiFor } from './classify.mjs';

loadDotEnv();

const args = new Set(process.argv.slice(2).map((a) => a.replace(/^--/, '')));
const DRY_RUN = args.has('dry-run');
const ALL = args.has('all');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY (get one at console.anthropic.com → API Keys).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // Pull the events to label. By default just the aggregated ones (source_uid set).
  let q = supabase.from('events').select('id, title, description, category');
  if (!ALL) q = q.not('source_uid', 'is', null);
  const { data: events, error } = await q;
  if (error) throw error;

  if (!events?.length) {
    console.log('No events to categorize.');
    return;
  }
  console.log(`Categorizing ${events.length} event(s) with Claude…`);

  const cats = await classifyEvents(
    events.map((e) => ({ title: e.title, description: e.description })),
    ANTHROPIC_API_KEY,
    { onProgress: (done, total) => process.stdout.write(`\r  labeled ${done}/${total}`) }
  );
  process.stdout.write('\n');

  // Summary of how the labels shook out.
  const tally = {};
  cats.forEach((c) => (tally[c] = (tally[c] || 0) + 1));
  console.log('  ' + Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(', '));

  if (DRY_RUN) {
    events.slice(0, 15).forEach((e, i) => console.log(`    ${cats[i].padEnd(10)} ${e.title}`));
    console.log('\n(dry run — nothing written)');
    return;
  }

  // Apply the new category + emoji. Update in small concurrent batches.
  let updated = 0;
  const BATCH = 25;
  for (let i = 0; i < events.length; i += BATCH) {
    const slice = events.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map((e, j) =>
        supabase
          .from('events')
          .update({ category: cats[i + j], emoji: emojiFor(cats[i + j]) })
          .eq('id', e.id)
      )
    );
    results.forEach((r) => {
      if (r.error) console.error(`  ! update error: ${r.error.message}`);
      else updated += 1;
    });
    process.stdout.write(`\r  updated ${Math.min(i + BATCH, events.length)}/${events.length}`);
  }
  process.stdout.write('\n');
  console.log(`Done. Re-labeled ${updated} event(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
