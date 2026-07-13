// Manage self-serve EVENT calendar submissions (event_sources). Unlike trucks,
// event calendars land PENDING and must be approved before the aggregator pulls
// them (see supabase/event_source_intake.sql).
//   node manage-event-sources.mjs                 # list all sources + status/health
//   node manage-event-sources.mjs --pending       # list only pending submissions
//   node manage-event-sources.mjs --approve <id>  # enable + mark approved (starts pulling)
//   node manage-event-sources.mjs --reject  <id>  # delete a pending submission
//   node manage-event-sources.mjs --disable <id>  # stop pulling it (keeps the row)
//   node manage-event-sources.mjs --enable  <id>  # resume pulling it
//   node manage-event-sources.mjs --remove  <id>  # delete it entirely
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';

loadDotEnv();
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function arg(k) {
  const i = process.argv.findIndex((x) => x === `--${k}` || x.startsWith(`--${k}=`));
  if (i === -1) return null;
  const a = process.argv[i];
  return a.includes('=') ? a.split('=').slice(1).join('=') : (process.argv[i + 1] || null);
}
const approve = arg('approve'), reject = arg('reject'), disable = arg('disable'), enable = arg('enable'), remove = arg('remove');
const pendingOnly = process.argv.includes('--pending');

if (approve) {
  const { error } = await sb.from('event_sources').update({ enabled: true, status: 'approved' }).eq('id', approve);
  console.log(error ? `failed: ${error.message}` : `Approved ${approve}. It starts pulling on the next aggregate run.`);
  process.exit(error ? 1 : 0);
}
if (reject) {
  const { error } = await sb.from('event_sources').delete().eq('id', reject).eq('status', 'pending');
  console.log(error ? `failed: ${error.message}` : `Rejected (deleted) pending ${reject}.`);
  process.exit(error ? 1 : 0);
}
if (remove) {
  const { error } = await sb.from('event_sources').delete().eq('id', remove);
  console.log(error ? `failed: ${error.message}` : `Removed ${remove}.`);
  process.exit(error ? 1 : 0);
}
if (disable || enable) {
  const id = disable || enable;
  const { error } = await sb.from('event_sources').update({ enabled: Boolean(enable) }).eq('id', id);
  console.log(error ? `failed: ${error.message}` : `${enable ? 'Enabled' : 'Disabled'} ${id}.`);
  process.exit(error ? 1 : 0);
}

let q = sb.from('event_sources').select('*').order('created_at', { ascending: false });
if (pendingOnly) q = q.eq('status', 'pending');
const { data, error } = await q;
if (error) { console.error(error.message); process.exit(1); }
if (!data.length) { console.log(pendingOnly ? 'No pending event-calendar submissions.' : 'No event sources registered.'); process.exit(0); }
const pend = data.filter((s) => s.status === 'pending');
if (!pendingOnly && pend.length) console.log(`** ${pend.length} PENDING submission(s) awaiting approval (node manage-event-sources.mjs --approve <id>) **\n`);
console.log(`${data.length} event source(s):\n`);
for (const s of data) {
  const mark = s.status === 'pending' ? 'PENDING ' : (s.enabled ? 'enabled ' : 'disabled');
  const health = s.last_error ? `ERROR: ${s.last_error}`
    : (s.last_event_count != null ? `${s.last_event_count} event(s) last pull` : 'not pulled yet');
  console.log(`  [${mark}] ${s.name}  |  ${s.city_id}  |  ${s.default_category || 'Community'}  |  ${health}`);
  console.log(`    ${s.url}`);
  console.log(`    contact: ${s.submitted_contact || '(none)'}  |  id: ${s.id}`);
  console.log('');
}
