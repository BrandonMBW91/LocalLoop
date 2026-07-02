// Moderation alert — emails the owner (localloop@localloop.io) whenever a
// submission lands in the moderation queue (status = 'pending').
//
// Called by database triggers (supabase/moderation_alerts.sql) via pg_net.
// AUTH: requires the shared secret in the `x-alert-secret` header (reuses the
// CRON_SECRET function secret). Sends via the Resend HTTP API using the
// already-verified findlayevents.com sending domain.
//
// Secrets required: CRON_SECRET, RESEND_API_KEY

const TO = 'localloop@localloop.io';
const FROM = 'Local Loop <noreply@findlayevents.com>';

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

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to: [TO], subject, text: lines.join('\n') }),
  });

  if (!res.ok) {
    console.error('resend error', res.status, (await res.text()).slice(0, 200));
    return new Response(JSON.stringify({ sent: false }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ sent: true }), { headers: { 'Content-Type': 'application/json' } });
});
