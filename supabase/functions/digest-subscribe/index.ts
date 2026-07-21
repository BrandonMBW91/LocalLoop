// Digest signup / confirm / unsubscribe — the web return path.
//
// Deploy:  supabase functions deploy digest-subscribe --no-verify-jwt
//   --no-verify-jwt is REQUIRED: confirm/unsubscribe are links clicked from an email
//   client, which cannot present a JWT. Authorization for those is possession of the
//   per-row token (24 random bytes) and nothing else, so the token must stay secret.
// Secret:  supabase secrets set RESEND_API_KEY=<key>
//
// WHY AN EDGE FUNCTION AND NOT DIRECT ANON INSERT (like push_tokens):
// this table holds email addresses. A publicly writable insert is an email-bombing
// vector — an attacker submits a victim's address over and over and WE send the
// confirmations. So digest_subscribers has no anon policy at all, and every write
// comes through here where the address is validated and confirmation resends are
// throttled (last_confirm_sent_at). See supabase/digest_subscribers.sql.
//
// Routes:
//   POST  /                      {email, city_id, interests?} -> sign up (pending)
//   GET   /?confirm=<token>      -> status=confirmed, HTML page
//   GET   /?unsubscribe=<token>  -> status=unsubscribed, HTML page

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND = 'https://api.resend.com/emails';
// Consumer bulk mail sends from the mail.localloop.io SUBDOMAIN, verified in Resend
// 2026-07-21. This is a reputation firewall, not cosmetics.
//
// Gmail and Yahoo score the DMARC-aligned domain, not the local part and not the ESP.
// Cold B2B outreach sends as Michael Williams <localloop@localloop.io> over Zoho and
// authenticates d=localloop.io. If consumer digest volume also authenticated
// d=localloop.io, then one annoyed subscriber hitting "spam" would degrade the
// deliverability of the outreach that is actually producing revenue. A separate
// subdomain gives the digest its own reputation to spend.
//
// If you change this address, send one test through Resend and confirm a 200 first:
// an unverified From 403s SILENTLY, so signups would keep returning "check your
// email" while no confirmation was ever sent.
const FROM = 'Local Loop <events@mail.localloop.io>';
// ...but replies still have to go somewhere a human reads. Measured 2026-07-21 by
// mailing all three addresses: localloop@ delivered, events@ and noreply@ BOUNCED —
// Zoho has no catch-all, so without this every reply to a digest email is lost.
// This does NOT undo the FROM rule above: that rule is about SENDING reputation, and
// Reply-To only affects inbound mail, which costs the outreach identity nothing.
const REPLY_TO = 'localloop@localloop.io';
const SITE = 'https://localloop.io';
// Resend confirmations no more than once per this window, so re-submitting the form
// cannot be used to repeatedly mail an address.
const CONFIRM_THROTTLE_MS = 10 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Small self-contained page for the confirm/unsubscribe landings. No app bundle, no
// external CSS: this renders in whatever browser the mail client opens.
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

const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

async function sendConfirm(email: string, town: string, token: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) { console.error('RESEND_API_KEY missing — cannot send confirmation'); return false; }
  // Path form (not ?t=), because site/_redirects forwards it with the proven
  // /for/* splat pattern. Keeping the link on localloop.io matters: a raw
  // supabase.co URL in a consumer email reads as phishing.
  const url = `${SITE}/digest/confirm/${token}`;
  const text =
    `Thanks for signing up for the Local Loop weekly email.\n\n` +
    `Confirm you want it and you will get ${town}'s events every Friday morning:\n${url}\n\n` +
    `If you did not sign up, just ignore this and nothing else will be sent.\n\nLocal Loop\n${SITE}\n`;
  const r = await fetch(RESEND, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [email],
      reply_to: REPLY_TO,
      subject: `Confirm your ${town} events email`,
      text,
      html: `<p>Thanks for signing up for the Local Loop weekly email.</p>
<p><a href="${url}">Confirm your subscription</a> and you will get <strong>${town}</strong>'s events every Friday morning.</p>
<p style="color:#78716c;font-size:14px">If you did not sign up, just ignore this and nothing else will be sent.</p>`,
    }),
  });
  if (!r.ok) console.error('confirm send failed', r.status, (await r.text()).slice(0, 200));
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const sb = admin();

  // --- confirm / unsubscribe: authorized purely by possession of the token ---
  const confirm = url.searchParams.get('confirm') || url.searchParams.get('t');
  const unsub = url.searchParams.get('unsubscribe') || url.searchParams.get('u');

  if (unsub) {
    const { data } = await sb.from('digest_subscribers')
      .update({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString() })
      .eq('token', unsub).select('email').maybeSingle();
    // Same page whether or not the token matched, so this can't be used to probe
    // which tokens (and therefore which addresses) exist.
    return page('You are unsubscribed', data
      ? 'You will not get the weekly email again. You can re-subscribe any time from the site.'
      : 'That link has already been used, or it expired. Either way you are not subscribed.');
  }

  if (confirm) {
    const { data } = await sb.from('digest_subscribers')
      .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
      .eq('token', confirm).neq('status', 'unsubscribed').select('city_id').maybeSingle();
    return page(data ? 'You are all set' : 'That link has expired', data
      ? 'Your first digest lands Friday morning with what is on near you this weekend.'
      : 'That confirmation link is no longer valid. Sign up again from the site and we will send a fresh one.');
  }

  // --- signup ---
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body: { email?: string; city_id?: string; interests?: string[] };
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const email = String(body.email || '').trim().toLowerCase();
  const city_id = String(body.city_id || '').trim();
  const interests = Array.isArray(body.interests) ? body.interests.slice(0, 12).map(String) : [];
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'invalid email' }, 400);
  if (!city_id) return json({ error: 'missing city' }, 400);

  const { data: existing } = await sb.from('digest_subscribers')
    .select('id, status, token, last_confirm_sent_at').eq('email', email).maybeSingle();

  // Already confirmed: keep their town current, do NOT re-send a confirmation.
  if (existing?.status === 'confirmed') {
    await sb.from('digest_subscribers').update({ city_id, interests }).eq('id', existing.id);
    return json({ ok: true, state: 'already_subscribed' });
  }

  let token = existing?.token as string | undefined;
  if (existing) {
    // Pending or previously unsubscribed -> reopen as pending. Re-subscribing after
    // an opt-out is allowed, but only by this deliberate act.
    const throttled = existing.last_confirm_sent_at &&
      Date.now() - Date.parse(existing.last_confirm_sent_at) < CONFIRM_THROTTLE_MS;
    if (throttled) return json({ ok: true, state: 'check_email' }); // silently no-op
    await sb.from('digest_subscribers')
      .update({ city_id, interests, status: 'pending', last_confirm_sent_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    const { data: created, error } = await sb.from('digest_subscribers')
      .insert({ email, city_id, interests, last_confirm_sent_at: new Date().toISOString() })
      .select('token').single();
    if (error) { console.error('insert failed', error.message); return json({ error: 'could not sign up' }, 500); }
    token = created!.token;
  }

  const town = city_id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  await sendConfirm(email, town, token!);
  return json({ ok: true, state: 'check_email' });
});
