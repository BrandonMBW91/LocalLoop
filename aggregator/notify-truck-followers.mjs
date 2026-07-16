// Notify truck followers (#1) — when a followed truck has a NEW upcoming stop,
// push its followers. Runs after truck-calendars.mjs in the daily cron.
//
// SAFETY: defaults to DRY RUN (logs who it WOULD notify, sends nothing). Pass
// --send to actually push. Kept dry until push delivery is verified on a real
// device, because push can't be tested from CI. Idempotent per stop: a
// notified_followers table records (source_uid) already pushed, so re-runs and
// re-upserts never double-notify.
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';

// Every sibling script loads .env; this one didn't, so it only ever worked in
// CI where the secrets arrive as real env vars. The moment the truck chain moved
// to the desktop it died with 'supabaseUrl is required'. loadDotEnv never
// overwrites values already in the environment, so CI is unaffected.
loadDotEnv();

const DRY = !process.argv.includes('--send');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // Upcoming, approved stops added in the last ~2 days (the cron cadence), that
  // carry a stable id we can dedupe on.
  const since = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const { data: stops, error } = await sb
    .from('food_trucks')
    .select('id, name, city_id, date, location_name, source_uid, created_at')
    .eq('status', 'approved')
    .gte('date', today)
    .gte('created_at', since);
  if (error) throw error;
  if (!stops?.length) { console.log('notify-followers: no recent stops'); return; }

  // Which stops have we already notified about? (source_uid for calendar stops;
  // id for user posts, which have no source_uid.)
  const keys = stops.map((s) => s.source_uid || s.id);
  const { data: done, error: dedupeErr } = await sb
    .from('notified_followers')
    .select('stop_key')
    .in('stop_key', keys);
  // If the dedupe query fails, ABORT — proceeding with an empty "already" set would
  // treat every stop as new and re-notify the whole 2-day window on every run.
  if (dedupeErr) { console.error('notify-followers: dedupe query failed, aborting to avoid mass re-notify:', dedupeErr.message); return; }
  const already = new Set((done || []).map((r) => r.stop_key));

  let notified = 0, wouldPush = 0;
  for (const s of stops) {
    const key = s.source_uid || s.id;
    if (already.has(key)) continue;

    // Followers of this truck name (case-insensitive) with a push token. Escape
    // %/_/\ AND '*' — PostgREST translates '*' in like/ilike patterns to the SQL
    // '%' wildcard, so a truck name containing '*' (names are user-supplied)
    // would match OTHER trucks' followers. '*' has no literal-escape through
    // PostgREST, so match it with the single-char wildcard '_' instead: strictly
    // narrower than '%', and the worst case is a one-character mismatch on a
    // same-length name rather than a cross-truck broadcast.
    const nameEsc = String(s.name || '').replace(/([\\%_])/g, '\\$1').replace(/\*/g, '_');
    const { data: followers, error: folErr } = await sb
      .from('truck_follows')
      .select('push_token')
      .ilike('truck_name', nameEsc)
      .not('push_token', 'is', null);
    // A failed follower query must NOT mark the stop as handled below — the
    // followers would then never be notified for this stop at all.
    if (folErr) { console.error(`notify-followers: follower lookup failed for "${s.name}" (will retry next run):`, folErr.message); continue; }
    const tokens = [...new Set((followers || []).map((f) => f.push_token).filter(Boolean))];

    let sendOk = true;
    if (tokens.length) {
// '2026-07-15' -> 'Wed, Jul 15' (the push used to show the raw ISO date).
function friendlyDay(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(d);
}
      const title = `${s.name} has a new stop`;
      const body = s.location_name
        ? `${s.location_name} on ${friendlyDay(s.date)}${s.start_time ? ` at ${s.start_time}` : ''}`
        : `New stop posted for ${friendlyDay(s.date)}`;
      wouldPush += tokens.length;
      if (!DRY) {
        const messages = tokens.map((to) => ({ to, title, body, sound: 'default' }));
        for (let i = 0; i < messages.length; i += 100) {
          try {
            const res = await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify(messages.slice(i, i + 100)),
            });
            if (!res.ok) { sendOk = false; console.error(`push send HTTP ${res.status}`); }
          } catch (e) { sendOk = false; console.error('push send failed:', e.message); }
        }
      }
      console.log(`${DRY ? '[dry] would notify' : 'notified'} ${tokens.length} follower(s) of "${s.name}" (${s.location_name || s.date})`);
      notified++;
    }
    // Record the stop as handled ONLY when the send path succeeded (or there
    // were genuinely zero followers). Recording a failed send would permanently
    // mark the stop notified with zero pushes delivered; leaving it unrecorded
    // lets the next run retry inside the 2-day window. (Dry runs never record,
    // so the first --send run still notifies the backlog once.)
    if (!DRY && sendOk) {
      const { error: insErr } = await sb.from('notified_followers')
        .upsert({ stop_key: key }, { onConflict: 'stop_key', ignoreDuplicates: true });
      if (insErr) console.error(`notify-followers: failed to record ${key} (may re-notify next run):`, insErr.message);
    }
  }
  console.log(`notify-followers: ${DRY ? 'DRY RUN — ' : ''}${notified} truck(s) with followers, ${wouldPush} push(es) ${DRY ? 'would be ' : ''}sent.`);
}

main().catch((e) => { console.error('notify-followers error:', e.message); process.exit(0); }); // never fail the cron
