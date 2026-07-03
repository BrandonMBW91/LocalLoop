// Weekend digest — sends a "what's on this weekend near you" push to every
// registered device, scoped to the town it registered in.
//
// Deploy (when you're at the computer):
//   supabase functions deploy weekend-digest
// Schedule it for ~9am Fridays via Supabase Dashboard → Edge Functions → Cron,
// or with pg_cron hitting the function URL. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided to the function automatically.
//
// AUTH: this sends a push to every device, so it must NOT be callable by anyone
// holding the public anon key. Set a CRON_SECRET function secret
// (`supabase secrets set CRON_SECRET=<random>`) and have the cron/pg_net call
// send it as the `x-cron-secret` header. Without a matching secret we 401.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Constant-time string compare so the gate can't be probed by timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// UTC offset (in minutes) of America/New_York at a given instant. Handles the
// EDT/EST switch so the weekend window lines up with Eastern local time, not UTC.
function easternOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', timeZoneName: 'shortOffset',
  }).formatToParts(at);
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT-5';
  const m = tz.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!m) return -300; // fall back to EST (-5h)
  return Number(m[1]) * 60 + (m[1].startsWith('-') ? -1 : 1) * Number(m[2] || 0);
}

// The UTC instant of the START of the next Monday in Eastern time. "This weekend"
// runs until then, so Sunday-evening events (which fall between Sun 8pm ET and
// Mon midnight ET) are still included instead of being cut off at Mon 00:00 UTC.
function nextMondayStartET(now: Date): Date {
  const offMin = easternOffsetMinutes(now);
  // Shift to Eastern wall-clock so we can find the local day, then figure out
  // how many days until the next Monday.
  const etNow = new Date(now.getTime() + offMin * 60000);
  const etDay = etNow.getUTCDay(); // 0 Sun .. 6 Sat, in Eastern local terms
  const daysToMon = (8 - etDay) % 7 || 7;
  // Eastern midnight of that Monday, expressed as a UTC instant.
  const etMidnight = Date.UTC(
    etNow.getUTCFullYear(), etNow.getUTCMonth(), etNow.getUTCDate() + daysToMon, 0, 0, 0, 0,
  );
  return new Date(etMidnight - offMin * 60000);
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('x-cron-secret') || '';
  if (!secret || !safeEqual(provided, secret)) {
    return new Response('unauthorized', { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // "This weekend" = from now until the start of next Monday in Eastern time.
  // Anchoring the end to Eastern midnight (not UTC midnight) keeps Sunday-evening
  // events in the window; a plain Mon 00:00 UTC cutoff is only Sun 8pm ET and
  // dropped everything happening Sunday night.
  const now = new Date();
  const end = nextMondayStartET(now);

  const { data: tokens } = await supabase.from('push_tokens').select('token, city_id');
  if (!tokens?.length) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no tokens' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const byCity: Record<string, string[]> = {};
  for (const t of tokens) {
    if (!t.token) continue;
    (byCity[t.city_id || 'findlay'] ||= []).push(t.token);
  }

  const messages: Array<Record<string, unknown>> = [];
  for (const [cityId, toks] of Object.entries(byCity)) {
    const { data: events } = await supabase
      .from('events')
      .select('title')
      .eq('city_id', cityId)
      .eq('status', 'approved')
      .gte('start_at', now.toISOString())
      .lt('start_at', end.toISOString())
      .order('view_count', { ascending: false })
      .limit(3);

    const count = events?.length || 0;
    if (!count) continue;
    const titles = (events as { title: string }[]).slice(0, 2).map((e) => e.title).join(', ');
    const body = count > 2 ? `${titles}, and more` : titles;
    for (const to of toks) {
      messages.push({ to, title: 'This weekend near you', body, sound: 'default' });
    }
  }

  // Expo push API accepts up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }

  return new Response(JSON.stringify({ sent: messages.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
