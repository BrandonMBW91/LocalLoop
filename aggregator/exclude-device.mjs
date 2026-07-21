// Mark one of YOUR OWN devices so it stops counting as an active user.
//
// Why this exists: per-town MAU sets ad pricing and is the outcome metric of the paid
// ad experiment, so the owner browsing his own site inflates the exact number he is
// using to make decisions. Signing in as admin in the APP already suppresses recording
// (AppContext's noTrack), but a signed-OUT phone or a desktop browser still counts.
//
// This marks rather than deletes, matching purge-bot-activity.mjs: every metric reads
// the human_activity view, which hides marked rows, and a mistake is one --unmark away.
// The mark is permanent because record_device_activity's upsert never touches
// excluded_at, so future visits from that device stay excluded with no repeat work.
//
//   node exclude-device.mjs --list                 recent web devices, newest first
//   node exclude-device.mjs --list --town=findlay  narrow to one town
//   node exclude-device.mjs d_abc123 [d_def456]    mark these as the owner's
//   node exclude-device.mjs --unmark d_abc123      undo
//   node exclude-device.mjs --status               what is currently excluded, and why
//
// FINDING YOUR DEVICE ID
//   Web  — open localloop.io, then in the browser console:
//            localStorage.getItem('@fe/deviceId')
//   App  — sign in as admin; recording is already suppressed, nothing to do.
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';

loadDotEnv();
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const LIST = args.includes('--list');
const STATUS = args.includes('--status');
const UNMARK = args.includes('--unmark');
const town = (args.find((a) => a.startsWith('--town=')) || '').split('=')[1];
const ids = args.filter((a) => !a.startsWith('--'));

if (STATUS) {
  const { data, error } = await sb
    .from('device_activity')
    .select('excluded_reason')
    .not('excluded_at', 'is', null);
  if (error) { console.error(error.message); process.exit(1); }
  const by = (data || []).reduce((m, r) => ((m[r.excluded_reason || 'null'] = (m[r.excluded_reason || 'null'] || 0) + 1), m), {});
  const { count: total } = await sb.from('device_activity').select('device_id', { count: 'exact', head: true });
  console.log(`excluded: ${data.length} of ${total} device rows`);
  for (const [reason, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${String(reason).padEnd(14)} ${n}`);
  if (!data.length) console.log('  (nothing excluded yet)');
  process.exit(0);
}

if (LIST) {
  let q = sb.from('device_activity')
    .select('device_id,city_id,platform,last_seen,excluded_at,excluded_reason')
    .order('last_seen', { ascending: false })
    .limit(40);
  if (town) q = q.eq('city_id', town);
  const { data, error } = await q;
  if (error) { console.error(error.message); process.exit(1); }
  console.log(`${data.length} most-recent device rows${town ? ` in ${town}` : ''}:\n`);
  for (const r of data) {
    const flag = r.excluded_at ? `EXCLUDED(${r.excluded_reason})` : '';
    console.log(`  ${r.device_id.padEnd(22)} ${String(r.city_id || '-').padEnd(18)} ${String(r.platform || '-').padEnd(8)} ${String(r.last_seen).slice(0, 16)}  ${flag}`);
  }
  console.log('\nMark yours with:  node exclude-device.mjs <device_id> [...]');
  process.exit(0);
}

if (!ids.length) {
  console.error('No device ids given. Try --list, --status, or pass one or more device ids.');
  process.exit(1);
}

if (UNMARK) {
  const { data, error } = await sb.from('device_activity')
    .update({ excluded_at: null, excluded_reason: null })
    .in('device_id', ids).select('device_id');
  if (error) { console.error(error.message); process.exit(1); }
  console.log(`un-marked ${data.length} device(s): ${data.map((d) => d.device_id).join(', ') || '(none matched)'}`);
  process.exit(0);
}

// Only stamp rows that are not already marked, so re-running never rewrites the
// original reason or timestamp (a device caught as a bot keeps that history).
const { data, error } = await sb.from('device_activity')
  .update({ excluded_at: new Date().toISOString(), excluded_reason: 'owner' })
  .in('device_id', ids).is('excluded_at', null).select('device_id,city_id');
if (error) { console.error(error.message); process.exit(1); }

if (!data.length) {
  console.log('Nothing changed — those ids are already excluded, or none matched.');
} else {
  console.log(`marked ${data.length} device(s) as the owner's:`);
  for (const d of data) console.log(`  ${d.device_id}  (${d.city_id || 'no town'})`);
  console.log('\nThey are now hidden from every active-user number. Undo with --unmark.');
}
