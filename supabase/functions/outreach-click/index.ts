// Outreach click tracker. A cold-email link points at localloop.io/for/<slug>
// (Netlify rewrites /for/* to this function). We log the click, then 302 the
// human to the site. Best-effort logging: a logging failure must NEVER stop the
// redirect. Public endpoint — deploy with --no-verify-jwt.
//
// Deploy:  supabase functions deploy outreach-click --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const HOME = 'https://localloop.io/';
// Link prefetchers / security scanners GET links with no human behind them.
// Flag them (meta.bot) so the funnel can exclude them, but still redirect — a
// real person behind a corporate scanner may follow the same link.
const BOT_RE = /bot|crawl|spider|preview|scan|monitor|curl|wget|python|okhttp|headless|facebookexternalhit|slackbot|bingpreview|proxy/i;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const slug = (url.searchParams.get('s') || '').slice(0, 80).toLowerCase().replace(/[^a-z0-9-]/g, '');
  const ua = req.headers.get('user-agent') || '';
  const dest = HOME + (slug ? `?ref=${encodeURIComponent(slug)}` : '');
  // Skip logging for link prefetchers / scanners (they fire no human intent and a
  // scripted flood would bloat outreach_events + egress) — still redirect them.
  if (slug && !BOT_RE.test(ua)) {
    try {
      await supabase.from('outreach_events').insert({
        event: 'click',
        slug,
        meta: {
          ua: ua.slice(0, 300),
          bot: BOT_RE.test(ua),
          referer: (req.headers.get('referer') || '').slice(0, 200) || null,
          ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
        },
      });
    } catch (e) {
      console.error('click log failed (redirecting anyway):', (e as Error).message);
    }
  }
  return new Response(null, { status: 302, headers: { Location: dest, 'Cache-Control': 'no-store' } });
});
