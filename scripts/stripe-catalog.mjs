// Creates the Local Loop ad products + Stripe Payment Links (with the exact
// metadata + custom-field keys the webhook expects). Run once per mode.
//
//   cd scripts && npm init -y && npm install stripe
//   # TEST:  STRIPE_SECRET_KEY=sk_test_... node stripe-catalog.mjs
//   # LIVE:  STRIPE_SECRET_KEY=sk_live_... node stripe-catalog.mjs
//
// Then paste the 3 printed URLs into site/advertise.html.

import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// [alphanumeric code (Stripe dropdown value), display label]. Codes map back to
// city_ids in the webhook (hyphens aren't allowed in Stripe dropdown values).
const TOWNS = [
  ['findlay', 'Findlay'], ['fostoria', 'Fostoria'], ['tiffin', 'Tiffin'], ['bowlinggreen', 'Bowling Green'],
  ['sandusky', 'Sandusky'], ['lima', 'Lima'], ['vanwert', 'Van Wert'], ['bellefontaine', 'Bellefontaine'],
  ['toledo', 'Toledo'], ['perrysburg', 'Perrysburg'], ['bluffton', 'Bluffton'], ['ada', 'Ada'],
  ['waterville', 'Waterville'], ['northbaltimore', 'North Baltimore'], ['carey', 'Carey'],
  ['leipsic', 'Leipsic'], ['arlington', 'Arlington'], ['pandora', 'Pandora'],
];

const text = (key, label, optional = false) => ({ key, label: { type: 'custom', custom: label }, type: 'text', optional });
const townField = { key: 'town', label: { type: 'custom', custom: 'Your town' }, type: 'dropdown', dropdown: { options: TOWNS.map(([value, label]) => ({ label, value })) } };

async function make(name, amount, recurring, productMeta, withTown) {
  const product = await stripe.products.create({ name });
  const price = await stripe.prices.create({
    product: product.id, unit_amount: amount, currency: 'usd',
    ...(recurring ? { recurring: { interval: 'month' } } : {}),
  });
  const custom_fields = withTown
    ? [text('businessname', 'Business name'), text('headline', 'Your ad headline'), townField]
    : [text('businessname', 'Business name'), text('headline', 'Your ad headline'), text('link', 'Website or phone (optional)', true)];
  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { product: productMeta },
    custom_fields,
  });
  return link.url;
}

const town = await make('Local Loop — Town Sponsor', 1900, true, 'town_sponsor', true);
const region = await make('Local Loop — All-Region Sponsor', 7900, true, 'all_region', false);
const featured = await make('Local Loop — Featured Listing (30 days)', 2500, false, 'featured_30', true);

console.log('TOWN_SPONSOR=' + town);
console.log('ALL_REGION=' + region);
console.log('FEATURED_30=' + featured);
