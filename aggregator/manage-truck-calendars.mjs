// Manage registered food-truck calendars. Self-serve submissions AUTO-APPROVE
// (no review queue by product decision), so this is for the occasional cleanup:
// pull a stale/closed/wrong feed, or re-enable one.
//   node manage-truck-calendars.mjs                 # list all registered calendars + health
//   node manage-truck-calendars.mjs --disable <id>  # stop pulling it (keeps the row)
//   node manage-truck-calendars.mjs --enable  <id>  # resume pulling it
//   node manage-truck-calendars.mjs --remove  <id>  # delete it entirely
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
const remove = arg('remove'), disable = arg('disable'), enable = arg('enable');

if (remove) {
  const { error } = await sb.from('truck_calendars').delete().eq('id', remove);
  console.log(error ? `failed: ${error.message}` : `Removed ${remove}.`);
  process.exit(error ? 1 : 0);
}
if (disable || enable) {
  const id = disable || enable;
  const { error } = await sb.from('truck_calendars').update({ enabled: Boolean(enable) }).eq('id', id);
  console.log(error ? `failed: ${error.message}` : `${enable ? 'Enabled' : 'Disabled'} ${id}.`);
  process.exit(error ? 1 : 0);
}

const { data, error } = await sb.from('truck_calendars').select('*').order('created_at', { ascending: true });
if (error) { console.error(error.message); process.exit(1); }
if (!data.length) { console.log('No truck calendars registered yet.'); process.exit(0); }
console.log(`${data.length} registered truck calendar(s):\n`);
for (const c of data) {
  const health = c.last_error ? `ERROR: ${c.last_error}`
    : (c.last_stop_count != null ? `${c.last_stop_count} stop(s) last pull` : 'not pulled yet');
  console.log(`  ${c.enabled ? '●' : '○'} ${c.name}  |  ${c.city_id}  |  ${c.cuisine}  |  ${health}`);
  console.log(`    ${c.ical_url}`);
  console.log(`    contact: ${c.submitted_contact || '(none)'}  |  id: ${c.id}`);
  console.log('');
}
