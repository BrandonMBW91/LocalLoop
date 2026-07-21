// All-Region ($79/mo) sponsors pay for EVERY town — including towns added after
// they checked out. The webhook can only insert rows for towns known at purchase
// time, so this daily step tops up each all-region purchase with rows for any
// picker towns it's missing. Idempotent (upsert on the session+city unique key).
//
//   node backfill-region-ads.mjs            # top up
//   node backfill-region-ads.mjs --dry-run  # report only
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { CITIES } from '../src/data/cities.js';

loadDotEnv();
// Accepts BOTH spellings on purpose. The repo had scripts taking --dry and others
// taking --dry-run, so typing the wrong one at the wrong script ran it FOR REAL with no
// warning. That happened on 2026-07-21: 'seatgeek.mjs --dry' was a live import.
// Widening the match can only ever make a run more dry, never less.
const DRY = process.argv.includes('--dry-run') || process.argv.includes('--dry');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const { data: rows, error } = await sb
  .from('sponsors')
  .select('city_id, title, body, link_url, active, ends_at, paused_reason, product, edit_token, stripe_customer_id, stripe_subscription_id, stripe_session_id')
  .eq('product', 'all_region')
  .not('stripe_session_id', 'is', null);
if (error) { console.error(error.message); process.exit(1); }

// One purchase = one stripe_session_id spanning many city rows.
const bySession = new Map();
for (const r of rows || []) {
  if (!bySession.has(r.stripe_session_id)) bySession.set(r.stripe_session_id, []);
  bySession.get(r.stripe_session_id).push(r);
}

const allIds = CITIES.map((c) => c.id);
let added = 0;
for (const [session, group] of bySession) {
  const have = new Set(group.map((r) => r.city_id));
  const missing = allIds.filter((id) => !have.has(id));
  if (!missing.length) continue;
  const rep = group[0]; // copy the ad content + state from an existing row
  const inserts = missing.map((city_id) => ({
    city_id,
    title: rep.title,
    body: rep.body,
    link_url: rep.link_url,
    active: rep.active,
    ends_at: rep.ends_at,
    paused_reason: rep.paused_reason,
    product: 'all_region',
    edit_token: rep.edit_token, // so backfilled towns share the advertiser's self-serve portal token
    stripe_customer_id: rep.stripe_customer_id,
    stripe_subscription_id: rep.stripe_subscription_id,
    stripe_session_id: session,
  }));
  console.log(`  ${rep.title}: +${missing.length} town(s) (${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''})`);
  if (DRY) continue;
  const { data: ins, error: insErr } = await sb
    .from('sponsors')
    .upsert(inserts, { onConflict: 'stripe_session_id,city_id', ignoreDuplicates: true })
    .select('id');
  if (insErr) console.error(`  ! ${insErr.message}`);
  else added += ins?.length || 0;
}
console.log(`${bySession.size} all-region purchase(s) checked · ${DRY ? 'dry run' : added + ' row(s) backfilled'}.`);
