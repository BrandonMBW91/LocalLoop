// Consolidated outreach funnel — one view across the scattered logs plus the
// click/conversion events, broken down by cohort (business vs truck) and town.
// Read-only; writes outreach/funnel.json and prints a summary.
//
//   node aggregator/outreach-funnel.mjs
//
// sent      = first-touch emails logged (unique recipients)
// bounced   = hard-bounced / blocklisted
// delivered = sent - bounced   (INFERRED; a seed-inbox test tells you inbox-vs-spam)
// replied   = real replies (now incl. personal-address replies via In-Reply-To)
// opt-out   = genuine "no thanks" replies (seeded do-not-contact rows excluded)
// clicks    = /for/<slug> link hits, bots excluded (only when link tracking is on)
// converted = Stripe checkouts attributed via client_reference_id
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const OUTREACH = join(ROOT, 'outreach');
const env = readFileSync(join(ROOT, '.env'), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const TOKEN = g('SUPABASE_ACCESS_TOKEN');
const PROJECT = 'wtaefyspddadcrnovumk';

const lines = (name) => { const p = join(OUTREACH, name); return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : []; };
const field0 = (l) => (l.split(/\s+/)[0] || '').toLowerCase();
const field1 = (l) => (l.split(/\s+/)[1] || '').toLowerCase();

// email -> {town, cohort}
const info = {};
try {
  for (const b of JSON.parse(readFileSync(join(OUTREACH, 'businesses.json'), 'utf8'))) {
    const e = (b.email || '').toLowerCase();
    if (e) info[e] = { town: b.town || 'Findlay', cohort: /food truck/i.test(b.category || '') ? 'truck' : 'business' };
  }
} catch { /* businesses.json optional */ }
const townOf = (e) => info[e]?.town || 'unknown';
const cohortOf = (e) => info[e]?.cohort || 'business';

const sent = [...new Set(lines('sent-log.txt').map(field1).filter(Boolean))];
const followups = lines('followup-log.txt').map(field1).filter(Boolean);
const bounced = new Set(lines('bounced.txt').map(field0).filter(Boolean));
const suppressRaw = lines('suppress.txt');
const optouts = new Set(suppressRaw.filter((l) => /\boptout\b/.test(l)).map(field0));
const seededDNC = suppressRaw.filter((l) => !/\boptout\b/.test(l)).length; // hand-seeded do-not-contact, NOT a response
const replied = new Set(lines('replied.txt').map(field0).filter(Boolean));
const seedSends = lines('seed-log.txt').length;

// click/conversion events (management API; the table is service-role only)
async function q(sql) {
  if (!TOKEN) return [];
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    const t = await r.text();
    const j = JSON.parse(t);
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}
let slugMap = {};
try { slugMap = JSON.parse(readFileSync(join(OUTREACH, 'click-slugs.json'), 'utf8')); } catch { /* none yet */ }
const clickRows = (await q("select slug, meta->>'bot' as bot from public.outreach_events where event='click';")).filter((r) => r.bot !== 'true');
const convRows = await q("select slug, ref from public.outreach_events where event='conversion';");
const clickTown = (slug) => slugMap[slug]?.town || (slug || '').replace(/-[0-9a-f]{8}$/, '').replace(/(^|-)([a-z])/g, (m, s, c) => s + c.toUpperCase()) || 'unknown';

// per-town aggregation
const towns = {};
const bump = (t, k, n = 1) => { (towns[t] ||= { sent: 0, bounced: 0, replied: 0, optout: 0, clicks: 0, converted: 0 }); towns[t][k] += n; };
for (const e of sent) { const t = townOf(e); bump(t, 'sent'); if (bounced.has(e)) bump(t, 'bounced'); if (replied.has(e)) bump(t, 'replied'); if (optouts.has(e)) bump(t, 'optout'); }
for (const r of clickRows) bump(clickTown(r.slug), 'clicks');
for (const r of convRows) bump(clickTown(r.slug || r.ref), 'converted');

// cohort totals
const cohort = { business: { sent: 0, replied: 0 }, truck: { sent: 0, replied: 0 } };
for (const e of sent) { const c = cohortOf(e); cohort[c].sent++; if (replied.has(e)) cohort[c].replied++; }

const deliveredEst = sent.length - bounced.size;
const pct = (n, d) => (d > 0 ? (100 * n / d).toFixed(1) + '%' : '-');
const summary = {
  generated_at: new Date().toISOString(),
  sent: sent.length, followups_sent: followups.length, seed_sends: seedSends,
  bounced: bounced.size, delivered_est: deliveredEst,
  replied: replied.size, reply_rate_of_delivered: pct(replied.size, deliveredEst),
  optouts: optouts.size, seeded_do_not_contact: seededDNC,
  clicks: clickRows.length, click_rate_of_delivered: pct(clickRows.length, deliveredEst),
  converted: convRows.length,
  by_cohort: cohort,
};
writeFileSync(join(OUTREACH, 'funnel.json'), JSON.stringify({ ...summary, by_town: towns }, null, 2) + '\n');

// ---- print ----
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
console.log('\n================  OUTREACH FUNNEL  ================');
console.log(`  ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC\n`);
console.log(`  Sent (first-touch)   ${sent.length}   (+${followups.length} follow-ups)`);
console.log(`  Bounced              ${bounced.size}`);
console.log(`  Delivered (est)      ${deliveredEst}   [inferred; run the seed test for inbox-vs-spam]`);
console.log(`  Replied              ${replied.size}   (${pct(replied.size, deliveredEst)} of delivered)`);
console.log(`  Opted out            ${optouts.size}   (+${seededDNC} hand-seeded do-not-contact, not responses)`);
console.log(`  Clicks               ${clickRows.length}   (${pct(clickRows.length, deliveredEst)} of delivered)${TRACK_NOTE()}`);
console.log(`  Converted            ${convRows.length}`);
console.log(`  Seed placements      ${seedSends} sent to your own inboxes — check inbox vs spam by hand`);
console.log(`\n  By cohort:  business ${cohort.business.replied}/${cohort.business.sent} replied · truck ${cohort.truck.replied}/${cohort.truck.sent} replied`);

const rows = Object.entries(towns).sort((a, b) => b[1].sent - a[1].sent).slice(0, 15);
if (rows.length) {
  console.log(`\n  ${pad('town', 20)}${padL('sent', 6)}${padL('bounce', 7)}${padL('reply', 6)}${padL('optout', 7)}${padL('click', 6)}${padL('conv', 6)}`);
  console.log('  ' + '-'.repeat(58));
  for (const [t, v] of rows) console.log(`  ${pad(t, 20)}${padL(v.sent, 6)}${padL(v.bounced, 7)}${padL(v.replied, 6)}${padL(v.optout, 7)}${padL(v.clicks, 6)}${padL(v.converted, 6)}`);
}
console.log('\n  Wrote outreach/funnel.json');
console.log('==================================================\n');

function TRACK_NOTE() { return clickRows.length === 0 ? '  [link tracking OFF by default — set OUTREACH_TRACK_LINKS=1 to enable]' : ''; }
