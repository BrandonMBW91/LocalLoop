// Stripe webhook — turns a paid checkout into a live ad automatically, and
// switches it off when the business cancels or a payment fails. No manual step.
//
// Deploy (when you're ready):
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Then in Stripe → Developers → Webhooks, add the function URL and subscribe to:
//   checkout.session.completed, customer.subscription.deleted, invoice.payment_failed
// Set these function secrets (Supabase → Edge Functions → Secrets):
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are provided automatically.)

import Stripe from 'https://esm.sh/stripe@16?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

// Stripe dropdown codes (alphanumeric) -> our city_id (which can have hyphens).
const CODE_TO_CITY: Record<string, string> = {
  findlay: 'findlay', fostoria: 'fostoria', tiffin: 'tiffin', bowlinggreen: 'bowling-green',
  sandusky: 'sandusky', lima: 'lima', vanwert: 'van-wert', bellefontaine: 'bellefontaine',
  toledo: 'toledo', perrysburg: 'perrysburg', bluffton: 'bluffton', ada: 'ada',
  waterville: 'waterville', northbaltimore: 'north-baltimore', carey: 'carey',
  leipsic: 'leipsic', arlington: 'arlington', pandora: 'pandora',
};
const ALL_CITY_IDS = [...new Set(Object.values(CODE_TO_CITY))];

function field(session: any, key: string): string {
  const f = (session.custom_fields || []).find((c: any) => c.key === key);
  return (f?.text?.value || f?.dropdown?.value || '').trim();
}

function cityIdFor(code: string): string {
  return CODE_TO_CITY[code] || code;
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const raw = await req.text();
  let event: any;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig!, WEBHOOK_SECRET);
  } catch (e) {
    return new Response(`bad signature: ${(e as Error).message}`, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const product = s.metadata?.product || 'town_sponsor'; // town_sponsor | all_region | featured_30
      // Sanitize buyer-supplied checkout fields before they become a live ad.
      const clamp = (v: string, n: number) => (v || '').slice(0, n);
      const business = clamp(field(s, 'businessname') || s.customer_details?.name || 'Local business', 120);
      const headline = clamp(field(s, 'headline'), 200);
      const rawLink = field(s, 'link');
      // Only allow safe link schemes — never javascript:/data: phishing.
      const link = /^(https:\/\/|tel:)/i.test(rawLink) ? clamp(rawLink, 300) : '';
      const town = field(s, 'town');
      const subId = s.subscription || null;
      const custId = s.customer || null;

      const cityIds = product === 'all_region' ? ALL_CITY_IDS : [cityIdFor(town)];
      const endsAt = product === 'featured_30' ? new Date(Date.now() + 30 * 86400000).toISOString() : null;

      const rows = cityIds.map((city_id) => ({
        city_id,
        title: business,
        body: headline || null,
        link_url: link || null,
        active: true,
        ends_at: endsAt,
        stripe_customer_id: custId,
        stripe_subscription_id: subId,
      }));
      await supabase.from('sponsors').insert(rows);
    } else if (event.type === 'customer.subscription.deleted') {
      await supabase.from('sponsors').update({ active: false }).eq('stripe_subscription_id', event.data.object.id);
    } else if (event.type === 'invoice.payment_failed') {
      const subId = event.data.object.subscription;
      if (subId) await supabase.from('sponsors').update({ active: false }).eq('stripe_subscription_id', subId);
    }
  } catch (e) {
    return new Response(`handler error: ${(e as Error).message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
