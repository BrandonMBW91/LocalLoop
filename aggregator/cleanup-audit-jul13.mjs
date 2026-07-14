// One-shot data cleanup for the Jul 13 2026 display-flaw audit. Each block
// mirrors an ingestion guard added the same night, so the junk it removes cannot
// return on the next feed pull. Dry by default; --apply writes.
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { outOfArea } from './towns.mjs';
import { cleanEventTitle } from './venue.mjs';

const APPLY = process.argv.includes('--apply');
loadDotEnv();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const nowIso = new Date().toISOString();

const TEST_TITLE_RE = /^test(?:ing)?\s*\d*$/i;
const CERT_SPAM_RE = /(?:PMP|SAFe|CISSP|Scrum Master|ITIL|Six Sigma|Salesforce|CompTIA)[^|]{0,40}(?:Certification|Training)|Classroom Training|\d+\s*-?\s*Days?\s+(?:Classroom\s+|Virtual\s+)?(?:Workshop|Training)/i;
const REGISTRAR_RE = /\b(?:last day to (?:remove|check out|submit|request|return|complete)|deadline for|residence hall|housing\/dining refund|conditional readmission)\b/i;
const CANCELLED_RE = /Organizer has had to cancel/i;
const TICKET_TERMS_RE = /valid (?:photo )?ID|Place Order|bag policy|will call|CASHLESS|clear bags?|no re-?entry|box office (?:opens|hours)|refund/i;
const URL_ONLY_RE = /^\s*https?:\/\/\S+\s*$/i;
const TRAILING_URL_RE = /\s*https?:\/\/\S+$/i;

// All approved rows still visible (upcoming or running).
let rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('events')
    .select('id,title,description,venue,address,host,city_id,price,start_at,end_at,source_uid')
    .eq('status', 'approved')
    .or(`start_at.gte.${nowIso},end_at.gte.${nowIso}`)
    .range(from, from + 999);
  if (error) { console.error('read ERR', error.message); process.exit(1); }
  rows.push(...(data || []));
  if (!data || data.length < 1000) break;
}
console.log(`scanned ${rows.length} visible approved rows`);

const del = { test: [], spam: [], registrar: [], cancelled: [], outOfState: [], overlong: [] };
const upd = []; // { id, patch }

for (const r of rows) {
  const t = String(r.title || '');
  const d = String(r.description || '');
  const feedRow = !!r.source_uid;

  // ---- deletions (feed rows only — never user submissions) ----
  if (feedRow && TEST_TITLE_RE.test(t)) { del.test.push(r.id); continue; }
  if (feedRow && CERT_SPAM_RE.test(t)) { del.spam.push(r.id); continue; }
  if (feedRow && REGISTRAR_RE.test(t)) { del.registrar.push(r.id); continue; }
  if (feedRow && CANCELLED_RE.test(d)) { del.cancelled.push(r.id); continue; }
  if (feedRow && outOfArea(`${r.venue || ''} ${r.address || ''}`)) { del.outOfState.push(r.id); continue; }
  // Year-long "events" (memberships, audio tours, standing restaurant specials).
  // 90 days keeps real exhibitions/fair seasons; beyond that it's an attraction,
  // not an event, and it squats at the top of "Today" forever.
  if (feedRow && r.end_at && (new Date(r.end_at) - new Date(r.start_at)) > 90 * 86400000) {
    del.overlong.push(r.id); continue;
  }

  // ---- updates ----
  const patch = {};
  // zero-minute events: end == start is feed noise, not a real end
  if (r.end_at && r.end_at === r.start_at) patch.end_at = null;
  // price "$0" -> Free
  if (String(r.price || '').trim() === '$0') patch.price = 'Free';
  // descriptions: TM ticket-terms boilerplate; URL-only; trailing plumbing URLs
  if (r.host === 'Ticketmaster' && TICKET_TERMS_RE.test(d)) {
    patch.description = `${t} — tickets via Ticketmaster.`;
  } else if (URL_ONLY_RE.test(d)) {
    patch.description = `From ${r.host || 'the organizer'}.`;
  } else if (TRAILING_URL_RE.test(d)) {
    let nd = d;
    while (TRAILING_URL_RE.test(nd)) nd = nd.replace(TRAILING_URL_RE, '').trim();
    patch.description = nd || `From ${r.host || 'the organizer'}.`;
  }
  // titles: own-city suffixes, ", OH 2026" tails, ALL-CAPS (feed rows only)
  if (feedRow) {
    const ct = cleanEventTitle(t, r.city_id);
    if (ct && ct !== t) patch.title = ct;
  }

  if (Object.keys(patch).length) upd.push({ id: r.id, patch });
}

const delTotal = Object.values(del).reduce((a, b) => a + b.length, 0);
console.log('deletes:', Object.fromEntries(Object.entries(del).map(([k, v]) => [k, v.length])), '=', delTotal);
console.log('updates:', upd.length);

if (!APPLY) { console.log('(dry run — use --apply)'); process.exit(0); }

let deleted = 0;
for (const ids of Object.values(del)) {
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await sb.from('events').delete().in('id', ids.slice(i, i + 100));
    if (error) console.error('del ERR', error.message); else deleted += Math.min(100, ids.length - i);
  }
}
let updated = 0, failed = 0;
for (const u of upd) {
  const { error } = await sb.from('events').update(u.patch).eq('id', u.id);
  if (error) failed++; else updated++;
}
console.log(`applied: deleted ${deleted} · updated ${updated} · failed ${failed}`);
