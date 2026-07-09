// Stripe webhook — turns a paid checkout into a live ad automatically, and
// switches it off when the business cancels or a payment fails. No manual step.
//
// Deploy (when you're ready):
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Then in Stripe → Developers → Webhooks, add the function URL and subscribe to:
//   checkout.session.completed, customer.subscription.deleted,
//   invoice.payment_failed, invoice.paid   (invoice.paid drives reactivation
//   after a failed-then-retried card — without it ads stay off forever)
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

// Fulfillment resolves against the FULL town catalog, not the "towns with
// events" list — a paying business in a currently-quiet town is still a valid
// purchase (the sweep caught v1 of this fix using active_cities() alone, which
// rejected quiet-town buyers as "unknown town"). The catalog below mirrors
// src/data/cities.js (79 towns, Jul 2026); the union with the live RPC also
// covers towns added after this deploy, once they have events. After adding a
// town, redeploy this function (docs/NEW_CITY.md).
// Stripe dropdown codes are the city_id with hyphens removed (dropdown values
// must be alphanumeric): 'bowlinggreen' -> 'bowling-green'.
const CATALOG_CITY_IDS = [
  // Northwest
  'findlay', 'fostoria', 'tiffin', 'bowling-green', 'sandusky', 'lima', 'van-wert',
  'toledo', 'perrysburg', 'sylvania', 'bluffton', 'ada', 'waterville',
  'north-baltimore', 'carey', 'leipsic', 'arlington', 'pandora', 'upper-sandusky',
  'fremont', 'wapakoneta', 'defiance', 'napoleon', 'bryan', 'wauseon',
  'port-clinton', 'catawba-island', 'put-in-bay', 'kelleys-island',
  'norwalk', 'st-marys', 'celina',
  // Central
  'bellefontaine', 'kenton', 'richwood', 'larue', 'prospect', 'green-camp',
  'marysville', 'marion', 'delaware', 'troy', 'piqua', 'sidney', 'greenville',
  'versailles', 'mansfield', 'ontario', 'ashland', 'bucyrus', 'galion', 'willard',
  'lakeview', 'russells-point',
  // Northeast
  'akron', 'cuyahoga-falls', 'kent', 'stow', 'hudson', 'tallmadge', 'barberton',
  'wadsworth', 'portage-lakes', 'canton', 'massillon', 'north-canton', 'hartville',
  'alliance', 'medina', 'ravenna', 'streetsboro', 'orrville', 'dover',
  'new-philadelphia', 'youngstown', 'warren', 'boardman', 'austintown', 'niles',
  'girard', 'struthers', 'canfield', 'salem', 'columbiana', 'wooster',
];
async function knownCityIds(): Promise<string[]> {
  const ids = new Set(CATALOG_CITY_IDS);
  try {
    const { data, error } = await supabase.rpc('active_cities');
    if (error) throw error;
    for (const id of Array.isArray(data) ? data : []) ids.add(id);
  } catch (e) {
    console.error('active_cities RPC failed, catalog only:', (e as Error).message);
  }
  return [...ids];
}
const codeToCity = (ids: string[]): Record<string, string> =>
  Object.fromEntries(ids.map((id) => [id.replace(/-/g, ''), id]));

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

// Notify the owner (fulfillment / exceptions). Goes to the monitored mailbox AND
// Michael's personal inbox, since he asked to be emailed on every feature/ad and
// doesn't routinely read localloop@.
const ALERT = 'michabw91@gmail.com';
const sendEmail = async (subject: string, text: string) => {
  await resendSend(OWNER, subject, text);
  await resendSend(ALERT, subject, text);
};

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
      const knownIds = await knownCityIds();
      const resolvedCity = town ? codeToCity(knownIds)[town.toLowerCase()] ?? null : null;
      const cityIds = product === 'all_region' ? knownIds : (resolvedCity ? [resolvedCity] : []);
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
        const paid = typeof s.amount_total === 'number' ? `$${(s.amount_total / 100).toFixed(0)}` : 'tier rate';
        await sendEmail(
          `ACTION: Featured Listing purchased by ${business} (${resolvedCity})`,
          `A Featured Listing (30 days, ${paid}) was just purchased.\n\nBusiness: ${business}\nHeadline: ${headline || '(none)'}\nLink: ${link || '(none)'}\nTown: ${resolvedCity}\nBuyer email: ${s.customer_details?.email || 'unknown'}\nStripe session: ${s.id}\n\nTO FULFILL: find their listing in the app and use the moderator Feature button (30 days). If you can't tell which listing, reply to the buyer to ask.`,
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
        product, // 'town_sponsor' | 'all_region' — lets the daily backfill extend all-region subs to towns added later
        stripe_customer_id: custId,
        stripe_subscription_id: subId,
        stripe_session_id: s.id,
      }));
      // Idempotent against Stripe retries/replays (unique on session_id + city_id).
      const { error: upsertErr } = await supabase
        .from('sponsors')
        .upsert(rows, { onConflict: 'stripe_session_id,city_id', ignoreDuplicates: true });
      if (upsertErr) throw upsertErr;

      // Tell the OWNER an ad was just placed (Michael asked to be notified on
      // every ad + feature). Best-effort, after the ad is safely created.
      const adWhere = product === 'all_region' ? `ALL ${cityIds.length} towns` : resolvedCity;
      await sendEmail(
        `New Local Loop ad: ${business} (${adWhere})`,
        `A ${product === 'all_region' ? 'region-wide' : 'town'} ad was just purchased and is now live.\n\n` +
          `Business: ${business}\nHeadline: ${headline || '(none)'}\nLink: ${link || '(none)'}\n` +
          `Where: ${adWhere}\nBuyer email: ${s.customer_details?.email || 'unknown'}\nStripe session: ${s.id}\n\n` +
          `Manage it in the app: Settings -> MODERATOR -> Manage Sponsors.`,
      );

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
      await supabase.from('sponsors')
        .update({ active: false, paused_reason: 'canceled' })
        .eq('stripe_subscription_id', event.data.object.id);
    } else if (event.type === 'invoice.payment_failed') {
      // Post-2025 Stripe API versions move invoice.subscription under
      // parent.subscription_details — read both so the handler works on any
      // dashboard-configured payload version.
      const obj = event.data.object;
      const subId = obj.subscription ?? obj.parent?.subscription_details?.subscription ?? null;
      if (subId) {
        await supabase.from('sponsors')
          .update({ active: false, paused_reason: 'payment_failed' })
          .eq('stripe_subscription_id', subId);
      }
    } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
      // A retry that succeeds turns the ad back on — but ONLY rows paused for
      // nonpayment. An ad the owner deliberately switched off (paused_reason
      // null) or a canceled sub must never silently un-pause on a paid invoice.
      const obj = event.data.object;
      const subId = obj.subscription ?? obj.parent?.subscription_details?.subscription ?? null;
      if (subId) {
        await supabase.from('sponsors')
          .update({ active: true, paused_reason: null })
          .eq('stripe_subscription_id', subId)
          .eq('paused_reason', 'payment_failed');
      }
    }
  } catch (e) {
    console.error('stripe-webhook handler error:', (e as Error).message);
    return new Response('error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
