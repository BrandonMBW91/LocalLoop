// Review + approve self-serve food-truck calendar submissions (status='pending',
// created via the in-app "Add my calendar" flow). Pending rows are enabled=false,
// so truck-calendars.mjs never pulls them until you approve here.
//   node approve-truck-calendars.mjs                 # list pending submissions
//   node approve-truck-calendars.mjs --approve <id>  # verify the feed, then enable it
//   node approve-truck-calendars.mjs --reject  <id>  # remove it
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';

loadDotEnv();
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const UA = { 'User-Agent': 'Mozilla/5.0 (LocalLoop truck-calendars)' };

// --flag <value> OR --flag=value
function arg(k) {
  const i = process.argv.findIndex((x) => x === `--${k}` || x.startsWith(`--${k}=`));
  if (i === -1) return null;
  const a = process.argv[i];
  return a.includes('=') ? a.split('=').slice(1).join('=') : (process.argv[i + 1] || null);
}

const approveId = arg('approve');
const rejectId = arg('reject');

if (rejectId) {
  const { error } = await sb.from('truck_calendars').delete().eq('id', rejectId).eq('status', 'pending');
  console.log(error ? `reject failed: ${error.message}` : `Rejected and removed ${rejectId}.`);
  process.exit(error ? 1 : 0);
}

if (approveId) {
  const { data: cal, error: e0 } = await sb.from('truck_calendars').select('*').eq('id', approveId).single();
  if (e0 || !cal) { console.error('No calendar with that id.'); process.exit(1); }
  // Verify the feed returns real iCal BEFORE enabling, so a bad link never goes live.
  try {
    const res = await fetch(cal.ical_url, { headers: UA, redirect: 'follow' });
    const text = await res.text();
    if (!res.ok || !/BEGIN:VCALENDAR/i.test(text)) throw new Error(`not iCal (HTTP ${res.status})`);
    const stops = (text.match(/BEGIN:VEVENT/g) || []).length;
    console.log(`Feed OK — ${stops} event(s) in ${cal.name}'s calendar.`);
  } catch (e) {
    console.error(`Feed check FAILED for ${cal.name}: ${e.message}. Not approving.`);
    console.error(`Confirm the link with the owner (${cal.submitted_contact || 'no contact given'}).`);
    process.exit(1);
  }
  const { error } = await sb.from('truck_calendars').update({ enabled: true, status: 'approved' }).eq('id', approveId);
  console.log(error ? `approve failed: ${error.message}`
    : `Approved ${cal.name} (${cal.city_id}). Stops pull on the next run: node truck-calendars.mjs`);
  process.exit(error ? 1 : 0);
}

// Default: list pending submissions.
const { data, error } = await sb.from('truck_calendars').select('*').eq('status', 'pending').order('created_at', { ascending: true });
if (error) { console.error(error.message); process.exit(1); }
if (!data.length) { console.log('No pending truck calendars. \u{1F389}'); process.exit(0); }
console.log(`${data.length} pending truck calendar submission(s):\n`);
for (const c of data) {
  console.log(`  ${c.name}  |  ${c.city_id}  |  ${c.cuisine}`);
  console.log(`    link:    ${c.ical_url}`);
  console.log(`    contact: ${c.submitted_contact || '(none)'}`);
  console.log(`    approve: node approve-truck-calendars.mjs --approve ${c.id}`);
  console.log(`    reject:  node approve-truck-calendars.mjs --reject ${c.id}`);
  console.log('');
}
