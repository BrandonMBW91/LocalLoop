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
  uppersandusky: 'upper-sandusky', kenton: 'kenton', richwood: 'richwood',
  larue: 'larue', prospect: 'prospect', greencamp: 'green-camp',
};
const ALL_CITY_IDS = [...new Set(Object.values(CODE_TO_CITY))];

function field(session: any, key: string): string {
  const f = (session.custom_fields || []).find((c: any) => c.key === key);
  return (f?.text?.value || f?.dropdown?.value || '').trim();
}

const FROM = 'Local Loop <noreply@findlayevents.com>';
const OWNER = 'localloop@localloop.io';

async function resendSend(to: string, subject: string, text: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return; // email is best-effort; never fail the webhook over it
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
    });
  } catch (e) {
    console.error('resend send failed:', (e as Error).message);
  }
}

// Notify the owner (fulfillment / exceptions).
const sendEmail = (subject: string, text: string) => resendSend(OWNER, subject, text);

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const raw = await req.text();
  let event: any;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig!, WEBHOOK_SECRET);
  } catch (e) {
    console.error('stripe signature verify failed:', (e as Error).message);
    return new Response('invalid signature', { status: 400 });
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

      // Resolve the town to a known city_id; never insert an orphan/empty one.
      const resolvedCity = town ? CODE_TO_CITY[town] : null;
      const cityIds = product === 'all_region' ? ALL_CITY_IDS : (resolvedCity ? [resolvedCity] : []);
      if (cityIds.length === 0) {
        // The buyer WAS charged but we couldn't resolve a town, so no ad exists.
        // Never let that vanish silently. Alert the owner to place it by hand.
        console.error('stripe-webhook: unknown town, skipping', { town, session: s.id });
        await sendEmail(
          `ACTION: paid ad with unknown town from ${business}`,
          `A ${product} ad was purchased but the town could not be matched, so NO ad was created.\n\nBusiness: ${business}\nHeadline: ${headline || '(none)'}\nLink: ${link || '(none)'}\nTown value received: ${town || '(blank)'}\nBuyer email: ${s.customer_details?.email || 'unknown'}\nStripe session: ${s.id}\n\nTO FIX: contact the buyer to confirm their town, then add the ad from the Manage Sponsors screen.`,
        );
        return new Response(JSON.stringify({ received: true, skipped: 'unknown town' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Featured Listing is NOT a sponsor ad: it boosts one specific listing,
      // which only the owner can identify. Fulfill by emailing the owner.
      if (product === 'featured_30') {
        await sendEmail(
          `ACTION: Featured Listing purchased by ${business} (${resolvedCity})`,
          `A Featured Listing (30 days, $25) was just purchased.\n\nBusiness: ${business}\nHeadline: ${headline || '(none)'}\nLink: ${link || '(none)'}\nTown: ${resolvedCity}\nBuyer email: ${s.customer_details?.email || 'unknown'}\nStripe session: ${s.id}\n\nTO FULFILL: find their listing in the app and use the moderator Feature button (30 days). If you can't tell which listing, reply to the buyer to ask.`,
        );
        const buyerEmail = s.customer_details?.email;
        if (buyerEmail) {
          await resendSend(
            buyerEmail,
            'Your Local Loop featured listing is on its way',
            `Thanks for supporting Local Loop.\n\nWe got your Featured Listing for ${resolvedCity} (30 days). We'll feature your listing in the app shortly. If we can't tell which listing is yours, we'll reply to this email to ask.\n\nQuestions? Just reply to this email.\n\nLocal Loop\nlocalloop.io`,
          );
        }
        return new Response(JSON.stringify({ received: true, fulfilled: 'featured_30 email sent' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const endsAt = null;

      const rows = cityIds.map((city_id) => ({
        city_id,
        title: business,
        body: headline || null,
        link_url: link || null,
        active: true,
        ends_at: endsAt,
        stripe_customer_id: custId,
        stripe_subscription_id: subId,
        stripe_session_id: s.id,
      }));
      // Idempotent against Stripe retries/replays (unique on session_id + city_id).
      const { error: upsertErr } = await supabase
        .from('sponsors')
        .upsert(rows, { onConflict: 'stripe_session_id,city_id', ignoreDuplicates: true });
      if (upsertErr) throw upsertErr;

      // Tell the buyer their ad is live so they don't panic (or dispute the charge)
      // after landing on Stripe's bare receipt page. Best-effort, never blocks.
      const buyerEmail = s.customer_details?.email;
      if (buyerEmail) {
        const where = product === 'all_region'
          ? 'every town Local Loop covers'
          : resolvedCity;
        await resendSend(
          buyerEmail,
          'Your Local Loop ad is live',
          `Thanks for supporting Local Loop.\n\nYour ad is now running in ${where}. It shows between listings for neighbors browsing the app.\n\nWant to add a logo, or change your headline or link? Just reply to this email and we'll update it.\n\nLocal Loop\nlocalloop.io`,
        );
      }
    } else if (event.type === 'customer.subscription.deleted') {
      await supabase.from('sponsors').update({ active: false }).eq('stripe_subscription_id', event.data.object.id);
    } else if (event.type === 'invoice.payment_failed') {
      const subId = event.data.object.subscription;
      if (subId) await supabase.from('sponsors').update({ active: false }).eq('stripe_subscription_id', subId);
    } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
      // A retry that succeeds (or any paid invoice) turns the ad back on —
      // pairs with the payment_failed deactivation above.
      const subId = event.data.object.subscription;
      if (subId) await supabase.from('sponsors').update({ active: true }).eq('stripe_subscription_id', subId);
    }
  } catch (e) {
    console.error('stripe-webhook handler error:', (e as Error).message);
    return new Response('error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
