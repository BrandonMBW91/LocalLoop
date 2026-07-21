// Moderation alert — emails the owner (localloop@localloop.io) whenever a
// submission lands in the moderation queue (status = 'pending').
//
// Called by database triggers (supabase/moderation_alerts.sql) via pg_net.
// AUTH: requires the shared secret in the `x-alert-secret` header (reuses the
// CRON_SECRET function secret). Sends via the Resend HTTP API using the
// already-verified findlayevents.com sending domain.
//
// Secrets required: CRON_SECRET, RESEND_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TO = 'localloop@localloop.io';
// localloop.io (verified in Resend 2026-07-21). Was findlayevents.com, the pre-rebrand
// domain, which was the only verified one until then.
const FROM = 'Local Loop <noreply@localloop.io>';
const ADMIN_EMAIL = 'michabw91@gmail.com'; // mirrors is_admin() in Postgres

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('x-alert-secret') || '';
  if (!secret || !safeEqual(provided, secret)) {
    return new Response('unauthorized', { status: 401 });
  }

  let p: Record<string, string> = {};
  try { p = await req.json(); } catch { /* keep defaults */ }

  const kind = (p.kind || 'submission').replace(/_/g, ' ');
  const title = p.title || 'Untitled';
  const town = p.town || 'unknown town';
  const when = p.start || '';
  const where = p.venue || '';

  const subject = `Moderation needed: ${kind} "${title}" (${town})`;
  const lines = [
    `A new ${kind} is waiting for review on Local Loop.`,
    '',
    `Title: ${title}`,
    `Town: ${town}`,
    when ? `When: ${when}` : '',
    where ? `Where: ${where}` : '',
    '',
    'Review it in the app: Settings -> MODERATOR -> Review Submissions.',
  ].filter((l) => l !== '');

  // 1) Email — the durable record / fallback. Non-fatal so a push still fires.
  let emailSent = false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [TO], subject, text: lines.join('\n') }),
    });
    emailSent = res.ok;
    if (!res.ok) console.error('resend error', res.status, (await res.text()).slice(0, 200));
  } catch (e) { console.error('email failed', String(e)); }

  // 2) Push to the owner's phone — the instant alert. Reuses push_tokens like the
  // spotlight function; targets only the admin's device(s).
  let pushSent = 0;
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: userData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const adminId = (userData?.users || []).find((u) => (u.email || '').toLowerCase() === ADMIN_EMAIL)?.id;
    if (adminId) {
      const { data: toks } = await supabase.from('push_tokens').select('token').eq('user_id', adminId);
      const messages = (toks || [])
        .map((t) => t.token).filter(Boolean)
        .map((to) => ({
          to, sound: 'default',
          title: `Review needed: ${kind}`,
          body: `"${title}"${town && town !== 'unknown town' ? ` · ${town}` : ''}`,
          data: { type: 'moderation' },
        }));
      if (messages.length) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(messages),
        });
        pushSent = messages.length;
      }
    }
  } catch (e) { console.error('push failed (non-fatal)', String(e)); }

  return new Response(JSON.stringify({ emailSent, pushSent }), { headers: { 'Content-Type': 'application/json' } });
});
