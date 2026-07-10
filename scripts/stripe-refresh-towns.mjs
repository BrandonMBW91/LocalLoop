// Syncs the "Your town" dropdown on the LIVE Stripe Payment Links with
// src/data/cities.js, so checkout never lags behind the towns the app covers.
// Run after adding towns: the webhook (active_cities RPC) and advertise.html
// (regenerated from cities.js) self-update, but the dropdowns baked into the
// payment links are the one Stripe-side piece that goes stale.
//
//   cd scripts && npm install
//   STRIPE_SECRET_KEY=sk_live_... node stripe-refresh-towns.mjs           # dry run
//   STRIPE_SECRET_KEY=sk_live_... node stripe-refresh-towns.mjs --apply   # write
//
// Dropdown codes are the city id with hyphens removed ('bowling-green' ->
// 'bowlinggreen') because Stripe dropdown values must be alphanumeric; the
// webhook (supabase/functions/stripe-webhook) maps them back the same way.

import Stripe from 'stripe';
import { CITIES } from '../src/data/cities.js';
import { CHECKOUT_BY_TIER, CHECKOUT_ANNUAL_BY_TIER } from '../src/data/checkout.js';

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('Set STRIPE_SECRET_KEY (the tier links live in LIVE mode, so sk_live_...).');
  process.exit(1);
}
const APPLY = process.argv.includes('--apply');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const options = CITIES
  .map((c) => ({ label: c.name, value: c.id.replace(/-/g, '') }))
  .sort((a, b) => a.label.localeCompare(b.label));

// Stripe hard-caps a dropdown at 200 options. Fail loudly BEFORE touching any
// live link, so crossing ~200 towns during the statewide scale-up can't silently
// half-update the checkout or drop towns 201+. When this trips, move the town
// field off a single flat dropdown (split per region, or pass town via metadata
// on a hosted checkout) — see the scale-readiness note in docs.
if (options.length > 200) {
  console.error(`ABORT: ${options.length} towns exceeds Stripe's 200-option dropdown cap. Re-architect the town field (per-region links or metadata checkout) before running this. No link was modified.`);
  process.exit(1);
}

// Updating a payment link REPLACES the whole custom_fields array, so every
// field the webhook reads must be restated here, not just the dropdown.
const text = (key, label) => ({ key, label: { type: 'custom', custom: label }, type: 'text' });
// NOTE: Stripe payment links hard-cap custom_fields at 3, and these links already
// use all three (businessname, headline, town-dropdown). There is NO room for a
// 4th "link" field here — adding one makes every --apply fail. To give town/
// featured buyers a clickable ad, the link must be collected another way (merge
// business name into the headline to free a slot, or capture it post-purchase).
const TOWN_FIELDS = [
  text('businessname', 'Business name'),
  text('headline', 'Your ad headline'),
  { key: 'town', label: { type: 'custom', custom: 'Your town' }, type: 'dropdown', dropdown: { options } },
];

// The tier links that carry a town dropdown (All-Region has none — skip it),
// with the metadata.product the webhook routes on.
const targets = [
  ...Object.entries(CHECKOUT_BY_TIER).flatMap(([tier, l]) => [
    { name: `${tier} town`, url: l.town, product: 'town_sponsor' },
    { name: `${tier} featured30`, url: l.featured30, product: 'featured_30' },
  ]),
  // Annual town links carry the SAME 122-town dropdown, so refresh them too.
  ...Object.entries(CHECKOUT_ANNUAL_BY_TIER).flatMap(([tier, l]) =>
    l.town ? [{ name: `${tier} town annual`, url: l.town, product: 'town_sponsor' }] : []),
];

// checkout.js stores the links' buy.stripe.com URLs, not their API ids — list
// the account's active payment links and match on url.
const byUrl = new Map();
for await (const link of stripe.paymentLinks.list({ active: true, limit: 100 })) {
  byUrl.set(link.url, link);
}

let problems = 0;
for (const t of targets) {
  const link = byUrl.get(t.url);
  if (!link) {
    console.error(`NOT FOUND among active payment links: ${t.name} (${t.url})`);
    problems++;
    continue;
  }
  if (link.metadata?.product !== t.product) {
    // Wrong/missing product metadata sends fulfillment down the wrong webhook
    // path (the July 2026 Local-featured bug). Flag it — fix in the dashboard.
    console.error(`METADATA MISMATCH on ${t.name}: product=${link.metadata?.product ?? '(none)'}, expected ${t.product}`);
    problems++;
  }
  const current = link.custom_fields?.find((f) => f.key === 'town')?.dropdown?.options || [];
  console.log(`${t.name}: ${current.length} -> ${options.length} towns${APPLY ? '' : ' (dry run)'}`);
  if (APPLY) await stripe.paymentLinks.update(link.id, { custom_fields: TOWN_FIELDS });
}
if (!APPLY) console.log('\nNothing written. Re-run with --apply to update the links.');
if (problems) process.exit(1);
