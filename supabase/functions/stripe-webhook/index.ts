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
  // Southeast
  'zanesville', 'cambridge', 'coshocton', 'marietta', 'belpre', 'athens',
  'nelsonville', 'logan', 'new-lexington', 'chillicothe', 'waverly', 'portsmouth',
  'ironton', 'jackson', 'wellston', 'mcarthur', 'gallipolis', 'pomeroy',
  'st-clairsville', 'steubenville', 'cadiz', 'woodsfield', 'caldwell', 'mcconnelsville',
  // Southwest
  'springfield', 'urbana', 'washington-court-house', 'hillsboro', 'greenfield',
  'wilmington', 'eaton', 'georgetown', 'ripley', 'west-union', 'peebles',
  'xenia', 'beavercreek',
  'ashtabula', // added by add-city.mjs,
  'geneva', // added by add-city.mjs,
  'conneaut', // added by add-city.mjs,
  'millersburg', // added by add-city.mjs,
  'mount-vernon', // added by add-city.mjs,
  'fredericktown', // added by add-city.mjs,
  'carrollton', // added by add-city.mjs,
  'paulding', // added by add-city.mjs,
  'columbus', // added by add-city.mjs,
  'cleveland', // added by add-city.mjs,
  'cincinnati', // added by add-city.mjs,
  'newark', // added by add-city.mjs,
  'new-albany', // added by add-city.mjs
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

// Turn a city_id slug into a human display name for BUYER-facing email copy, so a
// paying advertiser never reads "your ad is running in bowling-green". Irregular
// names are overridden; everything else is de-hyphenated + title-cased.
const CITY_DISPLAY: Record<string, string> = {
  'mcarthur': 'McArthur', 'mcconnelsville': 'McConnelsville', 'larue': 'LaRue',
  'st-marys': 'St. Marys', 'st-clairsville': 'St. Clairsville', 'put-in-bay': 'Put-in-Bay',
  'washington-court-house': 'Washington Court House',
};
const cityName = (slug: string): string =>
  CITY_DISPLAY[slug] || String(slug || '').split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function field(session: any, key: string): string {
  const f = (session.custom_fields || []).find((c: any) => c.key === key);
  return (f?.text?.value || f?.dropdown?.value || '').trim();
}

// localloop.io (verified in Resend 2026-07-21). This one is CUSTOMER-FACING: the
// buyer-confirmation below ("your ad is live") goes to whoever just paid. It used to
// arrive from findlayevents.com, the pre-rebrand domain, which a buyer has never seen
// and which reads as a phishing attempt on a charge they just made — i.e. dispute bait.
const FROM = 'Local Loop <noreply@localloop.io>';
const OWNER = 'localloop@localloop.io';

// replyTo is opt-in per-send: FROM is a noreply@ address with no mailbox behind it,
// so any mail we ASK the recipient to answer must carry one or the reply bounces.
async function resendSend(to: string, subject: string, text: string, replyTo?: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return; // email is best-effort; never fail the webhook over it
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
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

// Metro ad bundles — MUST stay in sync with src/data/bundles.js (edge functions
// can't import app source, so the map is copied here). The metro dropdown VALUE
// on the Stripe link is one of these keys; a purchase fans out to these towns.
const METRO_BUNDLES: Record<string, { name: string; towns: string[] }> = {
  toledo:      { name: 'Greater Toledo', towns: ['toledo', 'perrysburg', 'sylvania', 'bowling-green', 'waterville'] },
  akron:       { name: 'Akron Metro', towns: ['akron', 'cuyahoga-falls', 'kent', 'stow', 'hudson', 'tallmadge', 'barberton', 'wadsworth', 'medina', 'ravenna', 'streetsboro', 'portage-lakes'] },
  canton:      { name: 'Canton-Massillon', towns: ['canton', 'massillon', 'north-canton', 'hartville', 'alliance', 'orrville', 'dover', 'new-philadelphia'] },
  youngstown:  { name: 'Youngstown-Warren', towns: ['youngstown', 'warren', 'boardman', 'austintown', 'niles', 'girard', 'struthers', 'canfield', 'salem', 'columbiana'] },
  findlaylima: { name: 'Findlay-Lima', towns: ['findlay', 'fostoria', 'tiffin', 'fremont', 'bluffton', 'ada', 'lima', 'wapakoneta', 'van-wert', 'upper-sandusky', 'north-baltimore', 'carey'] },
  mansfield:   { name: 'Mansfield-North Central', towns: ['mansfield', 'ontario', 'ashland', 'bucyrus', 'galion', 'willard', 'marion', 'delaware'] },
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
      // Attribute a conversion back to outreach. The advertise-page Stripe links
      // carry ?client_reference_id=<slug> (set from a /for/<slug> click's ?ref),
      // which Stripe passes through here. Fire-and-forget — analytics logging must
      // NEVER affect fulfillment, so it's isolated in its own try/catch.
      try {
        const ref = String(s.client_reference_id || '').slice(0, 120);
        if (ref) {
          await supabase.from('outreach_events').insert({
            event: 'conversion', slug: ref, ref,
            meta: { session_id: s.id, product: s.metadata?.product || null, amount_total: s.amount_total ?? null, email: s.customer_details?.email || null },
          });
        }
      } catch (e) {
        console.error('outreach conversion log failed (non-fatal):', (e as Error).message);
      }
      // Defense in depth: only fulfill a genuinely-paid session (harmless for cards;
      // matters only if ACH/SEPA/Bacs are ever enabled on LIVE).
      if (s.payment_status && s.payment_status !== 'paid' && s.payment_status !== 'no_payment_required') {
        return new Response(JSON.stringify({ received: true, skipped: 'unpaid' }), { headers: { 'Content-Type': 'application/json' } });
      }
      const product = s.metadata?.product || 'town_sponsor'; // town_sponsor | all_region | metro_sponsor | featured_30 | deal
      // Sanitize buyer-supplied checkout fields before they become a live ad.
      const clamp = (v: string, n: number) => (v || '').slice(0, n);
      const business = clamp(field(s, 'businessname') || s.customer_details?.name || 'Local business', 120);
      const headline = clamp(field(s, 'headline'), 200);
      const rawLink = field(s, 'link');
      // Only allow safe link schemes — never javascript:/data: phishing.
      const link = /^(https:\/\/|tel:)/i.test(rawLink) ? clamp(rawLink, 300) : '';
      const town = field(s, 'town');
      const metro = (field(s, 'metro') || '').toLowerCase();
      const subId = s.subscription || null;
      const custId = s.customer || null;

      // Resolve the town to a known city_id; never insert an orphan/empty one.
      const knownIds = await knownCityIds();
      const resolvedCity = town ? codeToCity(knownIds)[town.toLowerCase()] ?? null : null;
      // Fan-out scope: all_region -> every town; metro_sponsor -> the metro's
      // towns (intersected with live catalog); otherwise the single resolved town.
      const cityIds =
        product === 'all_region' ? knownIds
        : product === 'metro_sponsor' ? (METRO_BUNDLES[metro]?.towns ?? []).filter((t) => knownIds.includes(t))
        : (resolvedCity ? [resolvedCity] : []);
      if (cityIds.length === 0) {
        // The buyer WAS charged but we couldn't resolve a town, so no ad exists.
        // Never let that vanish silently. Alert the owner to place it by hand.
        console.error('stripe-webhook: unknown town, skipping', { town, session: s.id });
        await sendEmail(
          `ACTION: paid ad with unknown town from ${business}`,
          `A ${product} ad was purchased but the town could not be matched, so NO ad was created.\n\nBusiness: ${business}\nHeadline: ${headline || '(none)'}\nLink: ${link || '(none)'}\nTown value: ${town || '(blank)'} · Metro value: ${metro || '(blank)'}\nBuyer email: ${s.customer_details?.email || 'unknown'}\nStripe session: ${s.id}\n\nTO FIX: contact the buyer to confirm their town/metro, then add the ad from the Manage Sponsors screen.`,
        );
        return new Response(JSON.stringify({ received: true, skipped: 'unknown town' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Featured Listing is NOT a sponsor ad: it boosts one specific listing,
      // which only the owner can identify. Fulfill by emailing the owner.
      if (product === 'featured_30') {
        // Idempotency: featured_30 writes no ad row, so a duplicate Stripe delivery
        // would email the owner twice (risking a double manual feature). Dedup on
        // stripe_session_id — only email when this session is seen for the first time.
        const { data: firstSeen, error: seenErr } = await supabase
          .from('processed_featured')
          .upsert({ stripe_session_id: s.id }, { onConflict: 'stripe_session_id', ignoreDuplicates: true })
          .select('stripe_session_id');
        if (seenErr) throw seenErr; // never 200 on a DB error — let Stripe retry, or a paid Featured Listing is lost silently
        if (!firstSeen || !firstSeen.length) {
          return new Response(JSON.stringify({ received: true, fulfilled: 'featured_30 duplicate ignored' }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const paid = typeof s.amount_total === 'number' ? `$${(s.amount_total / 100).toFixed(0)}` : 'tier rate';
        await sendEmail(
          `ACTION: Featured Listing purchased by ${business} (${cityName(resolvedCity)})`,
          `A Featured Listing (30 days, ${paid}) was just purchased.\n\nBusiness: ${business}\nHeadline: ${headline || '(none)'}\nLink: ${link || '(none)'}\nTown: ${cityName(resolvedCity)}\nBuyer email: ${s.customer_details?.email || 'unknown'}\nStripe session: ${s.id}\n\nTO FULFILL: find their listing in the app and use the moderator Feature button (30 days). If you can't tell which listing, reply to the buyer to ask.`,
        );
        const buyerEmail = s.customer_details?.email;
        if (buyerEmail) {
          await resendSend(
            buyerEmail,
            'Your Local Loop featured listing is on its way',
            `Thanks for supporting Local Loop.\n\nWe got your Featured Listing for ${cityName(resolvedCity)} (30 days). We'll feature your listing in the app shortly. If we can't tell which listing is yours, we'll reply to this email to ask.\n\nQuestions? Just reply to this email.\n\nLocal Loop\nlocalloop.io`,
            OWNER, // this one PROMISES we'll reply here to ask which listing is theirs
          );
        }
        return new Response(JSON.stringify({ received: true, fulfilled: 'featured_30 email sent' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Local Deal ($9/mo) -> a row in the deals table (shown in the app's Deals
      // list), NOT a between-listings ad. resolvedCity is guaranteed here (the
      // cityIds emptiness check above already alerted on an unresolvable town).
      if (product === 'deal') {
        const dealoffer = clamp(field(s, 'dealoffer'), 120);
        const { data: dealRows, error: dealErr } = await supabase.from('deals').upsert({
          city_id: resolvedCity,
          business_name: business,
          title: dealoffer || 'Local deal',
          link_url: link || null,
          active: true,
          stripe_customer_id: custId,
          stripe_subscription_id: subId,
          stripe_session_id: s.id,
        }, { onConflict: 'stripe_session_id', ignoreDuplicates: true }).select('stripe_session_id');
        if (dealErr) throw dealErr;
        // Email only on the FIRST delivery — a Stripe retry/replay upserts nothing
        // (ignoreDuplicates) and returns no rows, so buyer + owner aren't double-emailed.
        if (dealRows && dealRows.length) {
          await sendEmail(
            `New Local Deal: ${business} (${cityName(resolvedCity)})`,
            `A Local Deal was just purchased and is live.\n\nBusiness: ${business}\nDeal: ${dealoffer || '(none)'}\nTown: ${cityName(resolvedCity)}\nLink: ${link || '(none)'}\nBuyer email: ${s.customer_details?.email || 'unknown'}\nStripe session: ${s.id}\n\nManage it in the app: Settings -> MODERATOR -> Manage Deals.`,
          );
          const dealBuyer = s.customer_details?.email;
          if (dealBuyer) {
            await resendSend(
              dealBuyer,
              'Your Local Loop deal is live',
              `Thanks for supporting Local Loop.\n\nYour deal "${dealoffer || 'Local deal'}" is now showing in ${cityName(resolvedCity)} for neighbors browsing the app.\n\nWant to change the offer or add a link? Just reply to this email and we'll update it.\n\nLocal Loop\nlocalloop.io`,
              OWNER, // "reply to this email and we'll update it" is the only way to edit a deal
            );
          }
        }
        return new Response(JSON.stringify({ received: true, fulfilled: 'deal created' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const endsAt = null;
      // Per-subscription token for the self-serve portal — SAME across the fanned-out
      // town rows, so one edit updates every town the ad runs in. Unguessable (UUID).
      const editToken = crypto.randomUUID();

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
        edit_token: editToken,
      }));
      // Idempotent against Stripe retries/replays (unique on session_id + city_id).
      const { data: insertedRows, error: upsertErr } = await supabase
        .from('sponsors')
        .upsert(rows, { onConflict: 'stripe_session_id,city_id', ignoreDuplicates: true })
        .select('city_id');
      if (upsertErr) throw upsertErr;
      // First delivery only: a Stripe retry/replay inserts nothing, so skip the
      // owner + buyer emails below (the ad already exists).
      const firstDelivery = Array.isArray(insertedRows) && insertedRows.length > 0;
      // On a Stripe retry the rows already exist (ignoreDuplicates) and keep their
      // ORIGINAL edit_token; read the persisted one back so the buyer's manage link
      // always resolves to a real ad instead of this call's freshly-minted (unstored,
      // dead) token.
      const { data: tokenRow } = await supabase
        .from('sponsors')
        .select('edit_token')
        .eq('stripe_session_id', s.id)
        .not('edit_token', 'is', null)
        .limit(1)
        .maybeSingle();
      const manageToken = tokenRow?.edit_token ?? editToken;

      // Tell the OWNER an ad was just placed (Michael asked to be notified on
      // every ad + feature). Best-effort, after the ad is safely created.
      const adWhere = product === 'all_region' ? `ALL ${cityIds.length} towns`
        : product === 'metro_sponsor' ? `${METRO_BUNDLES[metro]?.name ?? metro} (${cityIds.length} towns)`
        : cityName(resolvedCity);
      if (firstDelivery) await sendEmail(
        `New Local Loop ad: ${business} (${adWhere})`,
        `A ${product === 'all_region' ? 'region-wide' : 'town'} ad was just purchased and is now live.\n\n` +
          `Business: ${business}\nHeadline: ${headline || '(none)'}\nLink: ${link || '(none)'}\n` +
          `Where: ${adWhere}\nBuyer email: ${s.customer_details?.email || 'unknown'}\nStripe session: ${s.id}\n\n` +
          `Manage it in the app: Settings -> MODERATOR -> Manage Sponsors.`,
      );

      // Tell the buyer their ad is live so they don't panic (or dispute the charge)
      // after landing on Stripe's bare receipt page. Best-effort, never blocks.
      const buyerEmail = s.customer_details?.email;
      if (firstDelivery && buyerEmail) {
        const where = product === 'all_region'
          ? 'every town Local Loop covers'
          : product === 'metro_sponsor'
          ? `the ${METRO_BUNDLES[metro]?.name ?? metro} area`
          : cityName(resolvedCity);
        await resendSend(
          buyerEmail,
          'Your Local Loop ad is live',
          `Thanks for supporting Local Loop.\n\nYour ad is now running in ${where}. It shows between listings for neighbors browsing the app.\n\nManage your ad yourself. Set the link people tap, your headline, or your business name (bookmark this):\nhttps://localloop.io/manage-ad.html?token=${manageToken}\n\nWant to add a logo too? Just reply to this email.\n\nLocal Loop\nlocalloop.io`,
          // The body above tells a paying customer to "just reply to this email", and
          // FROM is noreply@ — an address with no mailbox on the Zoho domain. Without
          // this, taking us up on it bounces, on the one email a new advertiser is
          // most likely to answer.
          OWNER,
        );
      }
    } else if (event.type === 'customer.subscription.deleted') {
      await supabase.from('sponsors')
        .update({ active: false, paused_reason: 'canceled' })
        .eq('stripe_subscription_id', event.data.object.id);
      await supabase.from('deals')
        .update({ active: false, paused_reason: 'canceled' })
        .eq('stripe_subscription_id', event.data.object.id);
    } else if (event.type === 'invoice.payment_failed') {
      // Post-2025 Stripe API versions move invoice.subscription under
      // parent.subscription_details — read both so the handler works on any
      // dashboard-configured payload version.
      const obj = event.data.object;
      const subId = obj.subscription ?? obj.parent?.subscription_details?.subscription ?? null;
      if (subId) {
        // Only pause rows that are currently ON, so an ad the owner deliberately
        // switched off isn't relabeled 'payment_failed' and then resurrected by the
        // next invoice.paid (which reactivates WHERE paused_reason='payment_failed').
        await supabase.from('sponsors')
          .update({ active: false, paused_reason: 'payment_failed' })
          .eq('stripe_subscription_id', subId)
          .eq('active', true);
        await supabase.from('deals')
          .update({ active: false, paused_reason: 'payment_failed' })
          .eq('stripe_subscription_id', subId)
          .eq('active', true);
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
        await supabase.from('deals')
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
