// Send a paying advertiser to Stripe's customer portal so they can cancel, update a
// card, or pull an invoice WITHOUT emailing Michael.
//
// WHY THIS EXISTS: as of 2026-07-21 the Stripe account had zero billing-portal
// configurations, so a monthly subscriber had no self-serve exit at all. The options
// left to them are "email a one-person company and wait" or "call the bank". The
// second one costs the sale plus a $15 dispute fee, plus another $15 if you contest
// and lose — and it is what people actually do when they cannot find a cancel button.
//
// Deploy: supabase functions deploy billing-portal --no-verify-jwt
//   --no-verify-jwt is REQUIRED: this is a link clicked from a browser (and from the
//   ad-is-live email's manage page), which cannot present a JWT.
//
// AUTH is possession of the ad's edit_token, exactly like manage-ad.html. The token is
// 24 random bytes, is only ever sent to the buyer's own address, and already grants
// edit rights on that ad — so it is not a privilege escalation to also let it open
// that customer's billing page. It is scoped by lookup: the portal session is created
// for the stripe_customer_id ON THAT ROW, so a token can never reach another
// customer's billing.
//
// Secrets: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SITE = 'https://localloop.io';

const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#faf9f7;color:#1c1917;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.card{max-width:30rem;padding:2.5rem 2rem;text-align:center}h1{font-size:1.4rem;margin:0 0 .6rem}
p{margin:0 0 1.25rem;color:#57534e}a{color:#b45309;font-weight:600;text-decoration:none}
@media(prefers-color-scheme:dark){body{background:#1c1917;color:#fafaf9}p{color:#a8a29e}}</style>
</head><body><div class="card"><h1>${title}</h1><p>${body}</p>
<a href="${SITE}">Go to Local Loop</a></div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = (url.searchParams.get('token') || '').trim();
  if (!token || token.length < 16) {
    return page('That link is not complete', 'Open the "manage your ad" link from your receipt email and try again.');
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: row, error } = await sb
    .from('sponsors')
    .select('stripe_customer_id')
    .eq('edit_token', token)
    .not('stripe_customer_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('sponsor lookup failed:', error.message);
    return page('Something went wrong', 'We could not open your billing page. Reply to your Local Loop email and we will sort it out.');
  }
  // Deliberately the same wording whether the token is unknown or simply has no Stripe
  // customer (a one-off Featured Listing has no subscription to manage). A different
  // message per case would let someone probe which tokens exist.
  if (!row?.stripe_customer_id) {
    return page('No subscription on this link', 'This ad was a one-time purchase, so there is nothing to cancel. Reply to your Local Loop email if you need a hand.');
  }

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) {
    console.error('STRIPE_SECRET_KEY missing');
    return page('Something went wrong', 'We could not open your billing page. Reply to your Local Loop email and we will sort it out.');
  }

  const body = new URLSearchParams();
  body.append('customer', row.stripe_customer_id);
  body.append('return_url', `${SITE}/manage-ad.html?token=${encodeURIComponent(token)}`);

  const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const session = await r.json().catch(() => null);
  if (!r.ok || !session?.url) {
    console.error('portal session failed:', r.status, JSON.stringify(session).slice(0, 200));
    return page('Something went wrong', 'We could not open your billing page just now. Reply to your Local Loop email and we will cancel it for you.');
  }

  // 303 so the browser switches to GET on the Stripe URL regardless of how it arrived.
  return new Response(null, { status: 303, headers: { Location: session.url } });
});
