// One-time cleanup: re-derive a consistent { venue, address } for events already
// in the database, so the same place stops showing up two different ways.
//
// Usage:
//   node fix-venues.mjs            # fix aggregated (feed) events
//   node fix-venues.mjs --dry-run  # show what would change, write nothing
//
// Env (from aggregator/.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { deriveVenue } from './venue.mjs';

loadDotEnv();

const DRY_RUN = process.argv.slice(2).includes('--dry-run');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // Aggregated events carry the source org name in `host`; use it as the venue
  // name when the location is a bare street address.
  const { data: events, error } = await supabase
    .from('events')
    .select('id, venue, address, host')
    .not('source_uid', 'is', null);
  if (error) throw error;
  if (!events?.length) {
    console.log('No aggregated events found.');
    return;
  }

  const changes = [];
  for (const e of events) {
    // `address` holds the original iCal location (empty if the feed gave none).
    // Re-derive from that alone so events with no location are left untouched.
    const { venue, address } = deriveVenue(e.address || '', e.host);
    if (venue !== e.venue || address !== e.address) {
      changes.push({ id: e.id, venue, address, before: e.venue });
    }
  }

  console.log(`${events.length} aggregated events; ${changes.length} need fixing.`);
  if (DRY_RUN) {
    changes.slice(0, 20).forEach((c) => console.log(`    "${c.before}"  →  "${c.venue}"`));
    console.log('\n(dry run — nothing written)');
    return;
  }

  let updated = 0;
  const BATCH = 25;
  for (let i = 0; i < changes.length; i += BATCH) {
    const slice = changes.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map((c) =>
        supabase.from('events').update({ venue: c.venue, address: c.address }).eq('id', c.id)
      )
    );
    results.forEach((r) => {
      if (r.error) console.error(`  ! ${r.error.message}`);
      else updated += 1;
    });
    process.stdout.write(`\r  updated ${Math.min(i + BATCH, changes.length)}/${changes.length}`);
  }
  process.stdout.write('\n');
  console.log(`Done. Fixed ${updated} event venue(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
