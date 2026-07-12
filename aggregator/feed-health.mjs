// Per-SOURCE health report — the complement to check-content.mjs's per-TOWN check.
// Reads the stamps aggregate.mjs writes (supabase/feed_health.sql) and flags
// sources that are erroring, parsing zero events, or haven't succeeded in days —
// so a dead feed is caught while the town still looks healthy.
//
//   node feed-health.mjs             # report
//   node feed-health.mjs --strict    # exit 1 if any enabled source is DEAD
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';

loadDotEnv();
const STRICT = process.argv.includes('--strict');
const STALE_DAYS = 7; // no successful pull in this long = stale
const ERR_GRACE_DAYS = 2; // erroring AND no success in this long = DEAD (not a one-pull blip)

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const { data: sources, error } = await sb
  .from('event_sources')
  .select('city_id, name, type, enabled, last_pulled_at, last_ok_at, last_event_count, last_error')
  .order('city_id');
if (error) { console.error(error.message); process.exit(1); }

const now = Date.now();
const days = (iso) => (iso ? (now - Date.parse(iso)) / 86400000 : Infinity);

const dead = [];    // erroring persistently (no recent success behind the error)
const blip = [];    // errored on the LAST pull but succeeded recently (transient)
const stale = [];   // last success too long ago
const empty = [];   // succeeding but parsing 0 events
const neverRun = []; // enabled but aggregate has never stamped it at all
for (const s of sources.filter((s) => s.enabled)) {
  // aggregate.mjs stamps last_error on EVERY failed pull and clears it on the
  // next success, so last_error alone means "the most recent pull failed" —
  // one transient blip on a months-healthy feed. DEAD needs the error to be
  // persistent (no success within the grace window; never-succeeded included
  // since days(null) is Infinity).
  if (!s.last_pulled_at && !s.last_ok_at) neverRun.push([s, 'never pulled (aggregate has not reached this source)']);
  else if (s.last_error && days(s.last_ok_at) > ERR_GRACE_DAYS) dead.push([s, `error: ${s.last_error.slice(0, 90)}`]);
  else if (s.last_error) blip.push([s, `last pull errored (ok ${Math.max(1, Math.floor(days(s.last_ok_at) * 24))}h ago): ${s.last_error.slice(0, 60)}`]);
  else if (s.last_pulled_at && days(s.last_ok_at) > STALE_DAYS) stale.push([s, `no success in ${Math.floor(days(s.last_ok_at))}d`]);
  else if (s.last_ok_at && s.last_event_count === 0) empty.push([s, 'parses 0 events']);
}

const enabled = sources.filter((s) => s.enabled).length;
const stamped = sources.filter((s) => s.enabled && s.last_pulled_at).length;
console.log(`Feed health — ${enabled} enabled sources (${stamped} stamped so far)\n`);
const show = (label, list) => {
  if (!list.length) return;
  console.log(`${label} (${list.length}):`);
  for (const [s, why] of list) console.log(`  ${s.city_id} · ${s.name} [${s.type}] — ${why}`);
  console.log('');
};
show('✗ DEAD', dead);
show('✗ NEVER-RUN', neverRun);
show('⚠ STALE', stale);
show('~ BLIP (errored last pull, recently ok)', blip);
show('… ZERO-EVENT', empty);
if (!dead.length && !neverRun.length && !stale.length && !blip.length && !empty.length) console.log('✔ all sources healthy.');

if (STRICT && (dead.length || neverRun.length)) process.exit(1);
