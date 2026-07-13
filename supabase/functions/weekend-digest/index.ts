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

// Event titles come from auto-approved third-party feeds, so screen each one
// before it lands in a push to every device: adult/profanity, embedded links, and
// obviously-garbled titles ('null', mojibake) are dropped from the digest body.
const UNSAFE_TITLE = /\b(f+u+c+k+\w*|sh[i1]t+\w*|b[i1]tch\w*|cunt|asshole|n[i1]gg\w*|fagg?ot|slut|whore|burlesque|strip(?:per|tease)?|lingerie|21\s*\+|18\s*\+|escort|\bxxx\b|porn)\b|https?:\/\/|www\.|\bnull\b|[�]|Ã.|â€/i;
const titleSafe = (t: string) => !!t && t.trim().length >= 4 && !UNSAFE_TITLE.test(t);

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
  let offMin = easternOffsetMinutes(now);
  // Shift to Eastern wall-clock so we can find the local day, then figure out
  // how many days until the next Monday.
  const etNow = new Date(now.getTime() + offMin * 60000);
  const etDay = etNow.getUTCDay(); // 0 Sun .. 6 Sat, in Eastern local terms
  const daysToMon = (8 - etDay) % 7 || 7;
  // Eastern midnight of that Monday, expressed as a UTC instant.
  const etMidnight = Date.UTC(
    etNow.getUTCFullYear(), etNow.getUTCMonth(), etNow.getUTCDate() + daysToMon, 0, 0, 0, 0,
  );
  // The offset can DIFFER at that Monday (DST transition weekends): a Friday
  // send used Friday's EDT offset for a Monday that is already EST, ending the
  // window an hour early. Recompute at the candidate instant and re-derive.
  let result = new Date(etMidnight - offMin * 60000);
  offMin = easternOffsetMinutes(result);
  result = new Date(etMidnight - offMin * 60000);
  return result;
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

  // Follow-up pass (~30 min after send): fetch Expo receipts and prune tokens
  // whose receipt says DeviceNotRegistered — our uninstall signal.
  if (new URL(req.url).searchParams.get('mode') === 'receipts') {
    return checkReceipts(supabase);
  }

  // "This weekend" = from now until the start of next Monday in Eastern time.
  // Anchoring the end to Eastern midnight (not UTC midnight) keeps Sunday-evening
  // events in the window; a plain Mon 00:00 UTC cutoff is only Sun 8pm ET and
  // dropped everything happening Sunday night.
  const now = new Date();
  const end = nextMondayStartET(now);

  // Paginate past PostgREST's 1000-row cap. Big-ticket #3 registers a token per
  // device, so token count now tracks install count; an unpaginated select would
  // silently drop everyone past 1000 exactly as the app succeeds.
  const tokens: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('push_tokens')
      .select('token, city_id, interests')
      .order('token', { ascending: true })
      .range(from, from + 999);
    if (error) {
      // A DB error is NOT "no tokens": returning 200 would let the workflow go
      // green while the entire weekly digest silently skipped. Fail loudly.
      return new Response(JSON.stringify({ sent: 0, error: `token fetch failed: ${error.message}` }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
    tokens.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  if (!tokens.length) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no tokens' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  type Tok = { token: string; city_id: string | null; interests: string[] | null };
  const byCity: Record<string, Tok[]> = {};
  for (const t of tokens as Tok[]) {
    if (!t.token) continue;
    (byCity[t.city_id || 'findlay'] ||= []).push(t);
  }

  const messages: Array<Record<string, unknown>> = [];
  for (const [cityId, toks] of Object.entries(byCity)) {
    // Pull the town's top events once (with category), then personalize per device.
    const { data: events } = await supabase
      .from('events')
      .select('title, category')
      .eq('city_id', cityId)
      .eq('status', 'approved')
      .gte('start_at', now.toISOString())
      .lt('start_at', end.toISOString())
      .order('view_count', { ascending: false })
      .limit(12);
    const list = (events as { title: string; category: string | null }[]) || [];
    if (!list.length) continue;

    for (const tk of toks) {
      const ints = Array.isArray(tk.interests) ? tk.interests : [];
      // Interest-matching events first (V8's sort is stable, so the view_count
      // order is preserved within each group); fall back to the town's top when
      // the device chose no interests.
      const ranked = ints.length
        ? [...list].sort((a, b) => (ints.includes(b.category || '') ? 1 : 0) - (ints.includes(a.category || '') ? 1 : 0))
        : list;
      // De-dupe by title so a recurring series (many rows, one title) can't fill the
      // body with the same event twice, e.g. "Art Show, Art Show, and more".
      const seenTitle = new Set<string>();
      const distinct: string[] = [];
      for (const e of ranked) {
        const t = (e.title || '').trim();
        if (!t || seenTitle.has(t.toLowerCase())) continue;
        if (!titleSafe(t)) continue; // never push an adult/profane/garbled title to every device
        seenTitle.add(t.toLowerCase());
        distinct.push(t);
        if (distinct.length >= 3) break; // 2 shown + 1 to know there's "more"
      }
      if (!distinct.length) continue;
      const body = distinct.length > 2 ? `${distinct.slice(0, 2).join(', ')}, and more` : distinct.slice(0, 2).join(', ');
      messages.push({ to: tk.token, title: 'This weekend near you', body, sound: 'default' });
    }
  }

  // Expo push API accepts up to 100 messages per request. Keep each ticket id
  // paired with its token so the receipts pass (?mode=receipts, run ~30 min
  // later) can detect DeviceNotRegistered = the app was uninstalled.
  let removedAtSend = 0;
  let failedBatches = 0;
  const ticketRows: Array<{ ticket_id: string; token: string }> = [];
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      // The fetch lives INSIDE the try: one transient network failure used to
      // throw out of the whole handler mid-send — remaining batches never sent
      // and the tickets already collected never persisted.
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
      const tickets = (await res.json())?.data || [];
      for (let j = 0; j < tickets.length; j++) {
        const t = tickets[j];
        const token = batch[j]?.to as string;
        if (!token) continue;
        if (t?.status === 'ok' && t.id) {
          ticketRows.push({ ticket_id: t.id, token });
        } else if (t?.details?.error === 'DeviceNotRegistered') {
          // Uninstalled (or token revoked) — stop pushing to it.
          await supabase.from('push_tokens').delete().eq('token', token);
          removedAtSend++;
        }
      }
    } catch { failedBatches++; /* skip this batch, keep sending the rest */ }
  }
  if (ticketRows.length) {
    await supabase.from('push_tickets').upsert(ticketRows, { onConflict: 'ticket_id', ignoreDuplicates: true });
  }

  return new Response(JSON.stringify({ sent: messages.length, removedAtSend, failedBatches, receiptsPending: ticketRows.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

// Receipts pass: Expo only knows DeviceNotRegistered for sure after handing the
// push to FCM/APNs, reported via receipts ~15 min post-send. The Friday workflow
// calls ?mode=receipts at 13:30 UTC; any receipt marked DeviceNotRegistered means
// the app was UNINSTALLED — we delete that push token and log it.
async function checkReceipts(supabase: ReturnType<typeof createClient>): Promise<Response> {
  const { data: pending } = await supabase
    .from('push_tickets')
    .select('ticket_id, token')
    .lt('created_at', new Date(Date.now() - 5 * 60000).toISOString());
  if (!pending?.length) {
    return new Response(JSON.stringify({ receiptsChecked: 0, uninstalled: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const byId = new Map(pending.map((p) => [p.ticket_id, p.token]));
  let uninstalled = 0;
  let checked = 0;
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 300) {
    const res = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ids: ids.slice(i, i + 300) }),
    });
    const receipts = (await res.json())?.data || {};
    for (const [id, r] of Object.entries(receipts) as Array<[string, any]>) {
      checked++;
      const token = byId.get(id);
      if (token && r?.status === 'error' && r?.details?.error === 'DeviceNotRegistered') {
        await supabase.from('push_tokens').delete().eq('token', token);
        uninstalled++;
        console.log('uninstall detected, token removed:', token.slice(0, 24) + '…');
      }
      await supabase.from('push_tickets').delete().eq('ticket_id', id);
    }
  }
  // Receipts Expo never produced expire after ~24h — sweep stale rows.
  await supabase.from('push_tickets').delete().lt('created_at', new Date(Date.now() - 2 * 86400000).toISOString());
  return new Response(JSON.stringify({ receiptsChecked: checked, uninstalled }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
