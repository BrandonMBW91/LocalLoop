// Spotlight push — a rare, human-triggered notification for genuinely big
// local moments (fireworks night, citywide sale weekend, fair opening).
//
// POST { city_id: 'findlay' | 'all', title, body, force?, dry? }
// Header: x-cron-secret (shared CRON_SECRET)
//
// NOISE GUARDRAIL: refuses to send if a spotlight went to the same audience in
// the last 4 days (override with force:true only for true back-to-back moments).
// dry:true reports the audience size without sending anything.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const COOLDOWN_DAYS = 4;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('x-cron-secret') || '';
  if (!secret || !safeEqual(provided, secret)) {
    return new Response('unauthorized', { status: 401 });
  }

  let p: Record<string, unknown> = {};
  try { p = await req.json(); } catch { /* defaults */ }
  const cityId = String(p.city_id || 'findlay');
  const title = String(p.title || '').trim();
  const body = String(p.body || '').trim();
  const force = p.force === true;
  const dry = p.dry === true;
  if (!title || !body) {
    return new Response(JSON.stringify({ error: 'title and body required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Cooldown: no spotlight to this audience in the last N days.
  if (!force) {
    const since = new Date(Date.now() - COOLDOWN_DAYS * 86400000).toISOString();
    let q = supabase.from('spotlight_log').select('id', { count: 'exact', head: true }).gte('sent_at', since);
    if (cityId !== 'all') q = q.in('city_id', [cityId, 'all']);
    const { count } = await q;
    if ((count || 0) > 0) {
      return new Response(JSON.stringify({ sent: 0, blocked: 'cooldown', note: `a spotlight already went out in the last ${COOLDOWN_DAYS} days` }), {
        status: 429, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  let tq = supabase.from('push_tokens').select('token, city_id');
  if (cityId !== 'all') tq = tq.eq('city_id', cityId);
  const { data: tokens } = await tq;
  const list = (tokens || []).filter((t) => t.token);

  if (dry) {
    return new Response(JSON.stringify({ dry: true, audience: list.length, cityId, title, body }), { headers: { 'Content-Type': 'application/json' } });
  }
  if (!list.length) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no tokens' }), { headers: { 'Content-Type': 'application/json' } });
  }

  const messages = list.map((t) => ({ to: t.token, title, body, sound: 'default' }));
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }
  await supabase.from('spotlight_log').insert({ city_id: cityId, title, body });

  return new Response(JSON.stringify({ sent: messages.length }), { headers: { 'Content-Type': 'application/json' } });
});
