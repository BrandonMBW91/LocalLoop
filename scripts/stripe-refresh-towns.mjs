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
import { CHECKOUT_BY_TIER } from '../src/data/checkout.js';

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('Set STRIPE_SECRET_KEY (the tier links live in LIVE mode, so sk_live_...).');
  process.exit(1);
}
const APPLY = process.argv.includes('--apply');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const options = CITIES
  .map((c) => ({ label: c.name, value: c.id.replace(/-/g, '') }))
  .sort((a, b) => a.label.localeCompare(b.label));

// Updating a payment link REPLACES the whole custom_fields array, so every
// field the webhook reads must be restated here, not just the dropdown.
const text = (key, label) => ({ key, label: { type: 'custom', custom: label }, type: 'text' });
const TOWN_FIELDS = [
  text('businessname', 'Business name'),
  text('headline', 'Your ad headline'),
  { key: 'town', label: { type: 'custom', custom: 'Your town' }, type: 'dropdown', dropdown: { options } },
];

// The tier links that carry a town dropdown (All-Region has none — skip it),
// with the metadata.product the webhook routes on.
const targets = Object.entries(CHECKOUT_BY_TIER).flatMap(([tier, l]) => [
  { name: `${tier} town`, url: l.town, product: 'town_sponsor' },
  { name: `${tier} featured30`, url: l.featured30, product: 'featured_30' },
]);

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
