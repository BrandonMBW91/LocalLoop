// Proactive feed-health ALERTING (big-ticket #9). feed-health.mjs reports; this
// escalates the high-signal cases so a town never silently empties:
//   CRITICAL = an active town whose feeds are ALL unhealthy (about to go dark).
//   WARNING  = an active town down to a single healthy source (one break from dark).
// Emails Michael only when there's a CRITICAL town, so it's signal, not spam.
// A source is "healthy" if it pulled OK within STALE_DAYS with >0 events — a
// transient last_error on a source that still succeeded recently is ignored.
//
//   node feed-health-alert.mjs            # report + email if CRITICAL
//   node feed-health-alert.mjs --dry-run  # report only, never email
//   node feed-health-alert.mjs --strict   # exit 1 if any CRITICAL (CI gate)
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';

loadDotEnv();
const DRY = process.argv.includes('--dry-run');
const STRICT = process.argv.includes('--strict');
const STALE_DAYS = 7;
const ALERT_TO = 'michabw91@gmail.com';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const now = Date.now();
const days = (iso) => (iso ? (now - Date.parse(iso)) / 86400000 : Infinity);
const healthy = (s) => s.last_ok_at && days(s.last_ok_at) <= STALE_DAYS && (s.last_event_count === null || s.last_event_count > 0);
const reason = (s) => s.last_error ? 'error: ' + s.last_error.slice(0, 70)
  : (s.last_event_count === 0 ? '0 events parsed'
  : `stale, last ok ${Math.floor(days(s.last_ok_at))}d ago`);

const { data: sources, error } = await sb
  .from('event_sources')
  .select('city_id, name, type, enabled, last_pulled_at, last_ok_at, last_event_count, last_error')
  .eq('enabled', true);
if (error) { console.error(error.message); process.exit(1); }

// Group by town; a town "counts" once it has been stamped at least once (i.e. it's live).
const byTown = new Map();
for (const s of sources) {
  if (!byTown.has(s.city_id)) byTown.set(s.city_id, []);
  byTown.get(s.city_id).push(s);
}
const critical = []; // 0 healthy sources
const warning = [];  // exactly 1 healthy source
for (const [town, list] of byTown) {
  const stamped = list.some((s) => s.last_pulled_at);
  if (!stamped) continue; // not yet run — don't false-alarm
  const h = list.filter(healthy).length;
  if (h === 0) critical.push({ town, total: list.length, sources: list });
  else if (h === 1) warning.push({ town, total: list.length });
}
critical.sort((a, b) => a.town.localeCompare(b.town));
warning.sort((a, b) => a.town.localeCompare(b.town));

console.log(`Feed-health alert — ${byTown.size} towns with sources · CRITICAL ${critical.length} · WARNING ${warning.length}\n`);
if (critical.length) {
  console.log('✗ CRITICAL (all feeds unhealthy — town about to empty):');
  for (const c of critical) {
    console.log(`  ${c.town} (${c.total} source${c.total === 1 ? '' : 's'}, 0 healthy):`);
    for (const s of c.sources) console.log(`      ${s.name} [${s.type}] — ${reason(s)}`);
  }
  console.log('');
}
if (warning.length) console.log(`⚠ WARNING single-source towns (${warning.length}): ${warning.map((w) => w.town).join(', ')}\n`);
if (!critical.length && !warning.length) console.log('✔ every town has 2+ healthy sources.');

// Email only for CRITICAL (rare + urgent). WARNING is informational in the report.
if (critical.length && !DRY) {
  if (!RESEND_API_KEY) { console.error('RESEND_API_KEY missing — cannot send alert email.'); }
  else {
    const body = `Feed-health alert for Local Loop.\n\n${critical.length} town(s) have NO healthy feed and will empty as their current events age out:\n\n` +
      critical.map((c) => `• ${c.town} (${c.total} source(s), 0 healthy)\n` + c.sources.map((s) => `    ${s.name} [${s.type}] — ${reason(s)}`).join('\n')).join('\n\n') +
      (warning.length ? `\n\nAlso ${warning.length} single-source town(s) (one break from dark): ${warning.map((w) => w.town).join(', ')}` : '') +
      `\n\nFix: repair or add a feed for these towns (see aggregator/feed-health.mjs, add-city runbook).`;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Local Loop <localloop@localloop.io>', to: [ALERT_TO], subject: `⚠ Feed-health: ${critical.length} Ohio town(s) about to empty`, text: body }),
    });
    console.log(r.ok ? `Alert emailed to ${ALERT_TO}.` : `Alert email failed: ${r.status} ${(await r.text()).slice(0, 120)}`);
  }
}

if (STRICT && critical.length) process.exit(1);
