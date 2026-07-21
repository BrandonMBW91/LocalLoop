// Keep crawler-generated rows out of the user metrics.
//
// MARKS, does not delete (changed 2026-07-21). Rows get excluded_at/excluded_reason
// stamped; every metric reads the human_activity view, which hides them. Same effect
// on every number, but a misfire is now visible and one UPDATE from being undone —
// whereas the old delete removed a real person with no way to notice.
//
// A JS-rendering crawler followed the SEO pages' "Open in Local Loop" link into
// the app. Bots keep no localStorage, so makeDeviceId() minted a NEW anonymous
// device on every single page — inflating device_activity (the metric that sets
// per-town ad pricing) and app_events. They are identifiable with certainty:
// makeDeviceId is `d_` + Date.now().toString(36) + Math.random().toString(36),
// and this client's JS engine reseeds identically per fresh context, so every
// one of its devices shares the SAME 8-char random suffix. Real humans keep one
// device across visits, so a shared suffix across many devices cannot be human.
//
// Deliberately conservative: only suffix groups at or above MIN_GROUP are
// touched, so a genuine 1-in-4-billion collision between two people is ignored.
//
//   node purge-bot-activity.mjs           dry run
//   node purge-bot-activity.mjs --apply   mark as excluded
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';

const APPLY = process.argv.includes('--apply');
// Devices sharing one RNG suffix before we call it automated.
//
// Was 5, which let a real 4-device crawler burst through on 2026-07-16 (4 Findlay
// devices in 195 seconds, all with random half "pjf2dke8"). It beat both the UA
// regex and the interacted gate; the shared suffix was the only thing that gave it
// away. The threshold was one too high, so the tuning was doing the opposite of its
// intent — the guard against false positives was the thing admitting false users.
//
// The suffix is 8 base36 chars = 36^8 = 2.82e12 outcomes. With ~113 web devices the
// chance of a GENUINE collision is:
//   2 sharing: 2.2e-9   3 sharing: 2.9e-20   4 sharing: 2.9e-31
// So 5 was guarding against a 1-in-1e31 event. At 3 the false-purge risk is
// 1 in 3.4e19 — it will not happen before the sun burns out. Still not 2, purely
// because a group of 2 is the only size where a bug in this script (rather than
// chance) could plausibly delete a real person, and 3 costs us nothing.
const MIN_GROUP = 3;
loadDotEnv();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

let rows = [];
for (let from = 0; ; from += 1000) {
  // Reads the RAW table on purpose. Every other consumer reads the human_activity
  // view; this is the thing that decides what belongs in it, so it has to see
  // everything — including rows it has already marked.
  const { data, error } = await sb.from('device_activity')
    .select('device_id,city_id,platform,last_seen,excluded_at').range(from, from + 999);
  if (error) { console.error('read ERR', error.message); process.exit(1); }
  rows.push(...(data || []));
  if (!data || data.length < 1000) break;
}

// Skip anything already marked (bot from a previous run, or the owner's own device):
// re-marking is harmless but it would re-report the same groups every morning and
// bury a genuinely new cluster in noise.
const web = rows.filter((r) => r.platform === 'web' && !r.excluded_at);
const bySuffix = new Map();
for (const r of web) {
  const s = String(r.device_id).slice(-8);
  if (!bySuffix.has(s)) bySuffix.set(s, []);
  bySuffix.get(s).push(r);
}
const botGroups = [...bySuffix.entries()].filter(([, g]) => g.length >= MIN_GROUP);
const botIds = botGroups.flatMap(([, g]) => g.map((r) => r.device_id));

console.log(`device_activity rows: ${rows.length} (web: ${web.length})`);
for (const [suffix, g] of botGroups) {
  const towns = [...new Set(g.map((r) => r.city_id))];
  console.log(`  suffix ${suffix}: ${g.length} devices | towns: ${towns.join(', ')} | ${g[0].last_seen.slice(0, 16)} -> ${g[g.length - 1].last_seen.slice(0, 16)}`);
}

// ---------------------------------------------------------------------------
// RULE 2: synchronized mint clusters.
//
// A second agent, better disguised than the suffix one, showed up 2026-07-16. It has
// REAL Math.random (so rule 1 is blind to it), passes the UA regex, reports
// navigator.webdriver === false, and fires an interaction event, so it clears the
// `interacted` gate too. It was inflating the paid ad towns badly: sandusky 16
// reported vs 8 real, canton 18 vs 12.
//
// It gives itself away on TIME. makeDeviceId is `d_` + Date.now().toString(36) + rnd,
// so every id carries its own mint instant. The agent minted 7 ids for sandusky inside
// 2419ms and every one of them recorded activity ~23-26s later — a spread of 4.7s
// across all seven. Humans do not land a millisecond apart, and they certainly do not
// share a dwell time to within a few seconds.
//
// COLLAPSE, never delete. The earliest id in a cluster is kept and the rest go. If the
// cluster is one agent, it now counts as 1 instead of 7. If it were somehow ONE person
// whose browser minted several ids (storage blocked mid-session), they still count as
// 1. Either way nobody real is erased — the failure mode is off-by-one, not a deleted
// user, which is why this is safe to run unattended.
//
// MIN_CLUSTER = 3 within CLUSTER_MS. At canton's ~18 visits/day the chance of even 2
// genuine visitors landing inside 2s is ~0.4%/day; 3 is not going to happen.
const CLUSTER_MS = 2000;
const MIN_CLUSTER = 3;
const mintMs = (id) => parseInt(String(id).slice(2, 10), 36); // the base36 Date.now()

const dupeIds = [];
const clusterLog = [];
const byTown = new Map();
for (const r of web) {
  if (botIds.includes(r.device_id)) continue; // already caught by rule 1
  if (!byTown.has(r.city_id)) byTown.set(r.city_id, []);
  byTown.get(r.city_id).push(r);
}
for (const [town, list] of byTown) {
  const sorted = list
    .filter((r) => Number.isFinite(mintMs(r.device_id)))
    .sort((a, b) => mintMs(a.device_id) - mintMs(b.device_id));
  let cur = [];
  const flush = () => {
    if (cur.length >= MIN_CLUSTER) {
      const span = mintMs(cur[cur.length - 1].device_id) - mintMs(cur[0].device_id);
      clusterLog.push(`  cluster ${town}: ${cur.length} ids in ${span}ms at ${new Date(mintMs(cur[0].device_id)).toISOString().slice(11, 19)} -> keeping 1`);
      dupeIds.push(...cur.slice(1).map((r) => r.device_id)); // keep the earliest
    }
    cur = [];
  };
  for (const r of sorted) {
    if (!cur.length || mintMs(r.device_id) - mintMs(cur[cur.length - 1].device_id) < CLUSTER_MS) cur.push(r);
    else { flush(); cur = [r]; }
  }
  flush();
}
clusterLog.forEach((l) => console.log(l));

const removeIds = [...new Set([...botIds, ...dupeIds])];
console.log(`bot devices to mark: ${botIds.length} (shared RNG suffix) + ${dupeIds.length} (synchronized clusters, collapsed to 1 each) = ${removeIds.length}`);
console.log(`real web devices counted: ${web.length - removeIds.length}`);

if (!removeIds.length) process.exit(0);
if (!APPLY) { console.log('(dry run — use --apply)'); process.exit(0); }

// MARK, don't delete. Every metric now reads the human_activity view, which hides
// marked rows, so marking has exactly the same effect on every number — but it is
// reversible and auditable. A delete was not: if this heuristic ever misfired on a
// real user, that user vanished with no way to notice, let alone undo it. Now a
// misfire is one query away from being seen:
//     select excluded_reason, count(*) from device_activity
//      where excluded_at is not null group by 1;
// and one UPDATE away from being undone.
const botSet = new Set(botIds);
let devMarked = 0, evDeleted = 0;
for (let i = 0; i < removeIds.length; i += 100) {
  const batch = removeIds.slice(i, i + 100);
  // app_events is not a pricing input and this delete is the existing behaviour.
  const { error: e1 } = await sb.from('app_events').delete().in('device_id', batch);
  if (e1) console.error('app_events del ERR', e1.message); else evDeleted += batch.length;
  // Split by reason so the audit trail says WHICH rule caught each device.
  for (const reason of ['bot:suffix', 'bot:cluster']) {
    const ids = batch.filter((id) => (reason === 'bot:suffix') === botSet.has(id));
    if (!ids.length) continue;
    const { error: e2, count } = await sb.from('device_activity')
      .update({ excluded_at: new Date().toISOString(), excluded_reason: reason }, { count: 'exact' })
      .in('device_id', ids)
      .is('excluded_at', null); // never overwrite an earlier mark (e.g. 'owner')
    if (e2) console.error('device_activity mark ERR', e2.message); else devMarked += count ?? ids.length;
  }
}
console.log(`applied: marked ${devMarked} bot devices as excluded, and deleted their app_events (${evDeleted} batches ok)`);
console.log('(marked, not deleted — reversible: update device_activity set excluded_at=null where excluded_reason like \'bot:%\')');
