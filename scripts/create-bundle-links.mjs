// Create the LIVE Stripe Payment Links for the regional/annual ad SKUs:
//   - Town Annual (Founding)   $190/yr   product=town_sponsor  [businessname, headline, town]
//   - Metro Monthly            $39/mo    product=metro_sponsor [businessname, headline, metro]
//   - Metro Annual             $390/yr   product=metro_sponsor [businessname, headline, metro]
//   - All-Region Annual        $790/yr   product=all_region    [businessname, headline]
//
//   cd scripts && STRIPE_SECRET_KEY=sk_live_... node create-bundle-links.mjs          # dry run
//   cd scripts && STRIPE_SECRET_KEY=sk_live_... node create-bundle-links.mjs --apply  # create
//
// Prints each link URL — paste them into src/data/checkout.js. Links are inert
// until something (advertise page / app) points at them. Metadata.product is what
// the webhook routes on; the metro dropdown value is the METRO_BUNDLES key.
import Stripe from 'stripe';
import { CITIES } from '../src/data/cities.js';
import { METRO_BUNDLES, BUNDLE_PRICING } from '../src/data/bundles.js';

if (!process.env.STRIPE_SECRET_KEY) { console.error('Set STRIPE_SECRET_KEY (sk_live_...).'); process.exit(1); }
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const APPLY = process.argv.includes('--apply');

const townOptions = CITIES.map((c) => ({ label: c.name, value: c.id.replace(/-/g, '') })).sort((a, b) => a.label.localeCompare(b.label));
const metroOptions = Object.entries(METRO_BUNDLES).map(([k, b]) => ({ label: b.name, value: k })).sort((a, b) => a.label.localeCompare(b.label));
const text = (key, label) => ({ key, label: { type: 'custom', custom: label }, type: 'text' });
const dropdown = (key, label, options) => ({ key, label: { type: 'custom', custom: label }, type: 'dropdown', dropdown: { options } });

const SKUS = [
  { nick: 'Town Annual (Founding)', product: 'town_sponsor', amount: BUNDLE_PRICING.townAnnual * 100, interval: 'year',
    fields: [text('businessname', 'Business name'), text('headline', 'Your ad headline'), dropdown('town', 'Your town', townOptions)] },
  { nick: 'Metro Monthly', product: 'metro_sponsor', amount: BUNDLE_PRICING.metro.monthly * 100, interval: 'month',
    fields: [text('businessname', 'Business name'), text('headline', 'Your ad headline'), dropdown('metro', 'Your metro area', metroOptions)] },
  { nick: 'Metro Annual', product: 'metro_sponsor', amount: BUNDLE_PRICING.metro.annual * 100, interval: 'year',
    fields: [text('businessname', 'Business name'), text('headline', 'Your ad headline'), dropdown('metro', 'Your metro area', metroOptions)] },
  { nick: 'All-Region Annual', product: 'all_region', amount: BUNDLE_PRICING.allRegion.annual * 100, interval: 'year',
    fields: [text('businessname', 'Business name'), text('headline', 'Your ad headline')] },
];

console.log(`Metro options: ${metroOptions.map((m) => m.value).join(', ')} | Town options: ${townOptions.length}`);
for (const s of SKUS) {
  console.log(`\n${s.nick} — $${s.amount / 100}/${s.interval} — product=${s.product} — ${s.fields.length} fields`);
  if (!APPLY) { console.log('  (dry run — nothing created)'); continue; }
  const price = await stripe.prices.create({
    currency: 'usd', unit_amount: s.amount, recurring: { interval: s.interval },
    product_data: { name: `Local Loop — ${s.nick}` },
  });
  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    custom_fields: s.fields,
    metadata: { product: s.product },
    allow_promotion_codes: true,
  });
  console.log(`  price ${price.id}`);
  console.log(`  LINK ${link.url}`);
}
if (!APPLY) console.log('\nDry run. Re-run with --apply to create the links.');
