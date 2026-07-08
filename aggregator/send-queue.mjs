// Paced, reputation-safe outreach sender with bounce top-up, opt-out suppression,
// proactive address checks, and a send-time window.
//
//   node send-queue.mjs [--limit=N] [--dry-run] [--force]
//
// Behavior:
//   • Daily quota = warm-up ramp (5/day until 15 GOOD sends, 8 until 40, then 10);
//     --limit can only lower it. Bounced sends DON'T count toward quota or ramp.
//   • Day-aware and idempotent: re-running the same day only sends the shortfall.
//   • Bounce sweep before AND after sending (3-min grace): kicked addresses are
//     blocklisted (bounced.txt), their Zoho draft deleted, notice trashed, and a
//     replacement is sent, up to 2 top-up rounds.
//   • Opt-out sweep: replies from recipients saying "no thanks / unsubscribe / …"
//     are added to suppress.txt (never contacted again) and their draft removed.
//     Other human replies are surfaced as "REPLY — review" so real interest isn't
//     missed. Sender addresses are matched to our recipients so only genuine
//     opt-outs are suppressed.
//   • Skips anyone already in the Zoho Sent folder / local log / suppress list.
//   • Proactive: each recipient's domain is MX-checked before sending; dead
//     domains are skipped this run (not a permanent bounce) so they don't burn the
//     bounce budget. Per-send retry (x2) means one SMTP hiccup can't abort the run.
//   • Interleaves across towns by priority weight (see town-priority.mjs), which is
//     best-effort refreshed at start so new users shift priorities automatically.
//   • Send window: only sends Mon-Sat 08:00-20:00 ET by default (--force or
//     SEND_ANYTIME=1 to override; OUTREACH_SEND_DAYS/START/END to tune). Sweeps
//     still run outside the window; only the outbound send is gated.
//   • Circuit breaker: >15% bounce rate (min 10 sent) pauses everything with ALERT.
//   • Writes outreach/last-run.json each run for observability.

import { readFileSync, writeFileSync, readdirSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveMx, resolve4 } from 'node:dns/promises';
import { execFileSync } from 'node:child_process';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { orderPending } from './town-order.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const env = readFileSync(join(ROOT, '.env'), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const USER = g('ZOHO_SMTP_USER');
const PASS = g('ZOHO_SMTP_PASS');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const r = a.replace(/^--/, ''); const i = r.indexOf('=');
  return i === -1 ? [r, true] : [r.slice(0, i), r.slice(i + 1)];
}));
const DRY = Boolean(args['dry-run']);
const FORCE = Boolean(args.force) || process.env.SEND_ANYTIME === '1';
const GRACE_MS = 3 * 60 * 1000; // wait for immediate bounces before topping up
const TOPUP_ROUNDS = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OUTREACH = join(ROOT, 'outreach');
const LOG = join(OUTREACH, 'sent-log.txt');
const BOUNCED = join(OUTREACH, 'bounced.txt');
const SUPPRESS = join(OUTREACH, 'suppress.txt');
const readLines = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : []);
const today = new Date().toLocaleDateString('en-CA');

// ---- send window (ET) ----
const SEND_DAYS = (process.env.OUTREACH_SEND_DAYS || 'Mon,Tue,Wed,Thu,Fri,Sat').split(',').map((s) => s.trim());
const SEND_START = Number(process.env.OUTREACH_SEND_START ?? 8);
const SEND_END = Number(process.env.OUTREACH_SEND_END ?? 20);
const etParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
const etHour = Number(etParts.hour) % 24;
const etDay = etParts.weekday;
const inWindow = SEND_DAYS.includes(etDay) && etHour >= SEND_START && etHour < SEND_END;

// Best-effort refresh of town priority weights (live user counts) before we read
// them. Never blocks sending if the DB is unreachable.
try { execFileSync('node', [join(HERE, 'town-priority.mjs')], { stdio: 'ignore' }); }
catch { /* keep last town-weights.json */ }

// ---- queue ----
const draftsDir = join(OUTREACH, 'drafts');
const files = readdirSync(draftsDir).filter((f) => /^\d+.*\.txt$/.test(f)).sort();
const queue = files.map((f) => {
  const lines = readFileSync(join(draftsDir, f), 'utf8').split(/\r?\n/);
  return {
    file: f,
    to: ((lines[0].match(/^TO:\s*(.+)$/) || [])[1] || '').toLowerCase(),
    subject: (lines[1].match(/^SUBJECT:\s*(.+)$/) || [])[1] || '',
    body: lines.slice(3).join('\n').trim() + '\n',
  };
}).filter((d) => d.to && d.subject && d.body.trim().length > 20);
const queueTos = new Set(queue.map((d) => d.to));

const bounced = new Set(readLines(BOUNCED).map((l) => l.split(/\s+/)[0].toLowerCase()));
const suppressed = new Set(readLines(SUPPRESS).map((l) => l.split(/\s+/)[0].toLowerCase()));

// addresses to skip only for THIS run (send errors, dead domains) — remain
// pending for a future run rather than being permanently blocklisted.
const skipRun = new Set();

function freshImap() {
  const c = new ImapFlow({ host: 'imap.zoho.com', port: 993, secure: true, auth: { user: USER, pass: PASS }, logger: false, socketTimeout: 5 * 60 * 1000 });
  c.on('error', (e) => console.error('imap error (non-fatal):', e.message));
  return c;
}

async function getSentTos() {
  const imap = freshImap();
  await imap.connect();
  const sentTos = new Set();
  const lock = await imap.getMailboxLock('Sent');
  try {
    for await (const msg of imap.fetch('1:*', { envelope: true })) {
      for (const r of msg.envelope?.to || []) sentTos.add((r.address || '').toLowerCase());
    }
  } catch { /* empty */ } finally { lock.release(); }
  await imap.logout();
  return sentTos;
}

// Delete Zoho drafts addressed to any address in `addrSet`. Own connection.
async function removeDraftsFor(addrSet) {
  if (!addrSet.size || DRY) return;
  const imap = freshImap();
  try {
    await imap.connect();
    const lock = await imap.getMailboxLock('Drafts');
    try {
      const doomed = [];
      for await (const msg of imap.fetch('1:*', { envelope: true, uid: true })) {
        const to = ((msg.envelope?.to?.[0]?.address) || '').toLowerCase();
        if (addrSet.has(to)) doomed.push(msg.uid);
      }
      if (doomed.length) await imap.messageDelete(doomed, { uid: true });
    } finally { lock.release(); }
    await imap.logout();
  } catch (e) { console.error('draft cleanup failed (non-fatal):', e.message); }
}

// Sweep failure notices; blocklist matched recipients, trash notices, delete
// their Zoho drafts. Returns the newly-bounced addresses.
async function sweepBounces(knownTos) {
  const imap = freshImap();
  await imap.connect();
  const newly = [];
  {
    const lock = await imap.getMailboxLock('INBOX');
    try {
      // ONLY daemon/postmaster senders — subject keywords alone would match real
      // human replies ("delivery available?") and blocklist good prospects.
      const since = new Date(Date.now() - 30 * 86400000);
      const uidSets = await Promise.all([
        imap.search({ from: 'mailer-daemon', since }, { uid: true }),
        imap.search({ from: 'postmaster', since }, { uid: true }),
        imap.search({ from: 'maildelivery', since }, { uid: true }),
      ].map((p) => p.catch(() => [])));
      const uids = [...new Set(uidSets.flat().filter(Boolean))].slice(0, 100);
      const doomed = [];
      for (const uid of uids) {
        try {
          const { content } = await imap.download(String(uid), undefined, { uid: true });
          let text = '';
          for await (const chunk of content) { text += chunk.toString('utf8'); if (text.length > 200000) break; }
          const found = [...knownTos].filter((t) => text.toLowerCase().includes(t));
          if (found.length) {
            found.forEach((t) => { if (!bounced.has(t)) { bounced.add(t); newly.push(t); } });
            doomed.push(uid);
          }
        } catch (e) { console.error('notice read failed (skipping):', e.message); }
      }
      if (doomed.length && !DRY) await imap.messageMove(doomed, 'Trash', { uid: true });
    } catch (e) { console.error('bounce sweep error (continuing):', e.message); }
    finally { lock.release(); }
  }
  if (newly.length && !DRY) newly.forEach((t) => appendFileSync(BOUNCED, `${t}  ${new Date().toISOString()}\n`));
  await imap.logout();
  if (newly.length) { await removeDraftsFor(new Set(newly)); console.log('bounced -> blocklisted, draft removed, notice trashed:', newly.join(', ')); }
  return newly;
}

// Opt-out phrases people actually reply with. Kept tight so a merely-negative
// word doesn't suppress an otherwise-interested reply.
const OPTOUT_RE = /\b(unsubscribe|no thanks|no thank you|remove me|take me off|please remove|stop emailing|stop sending|do ?n[o']t (?:email|contact|message)|opt[- ]?out|not interested|leave me alone|take my (?:name|email) off)\b/i;

// Scan INBOX for genuine replies from people we emailed. Opt-outs -> suppress.txt
// (+ draft removed). Everything else is surfaced for a human to read. Returns
// { newlySuppressed, replies }.
async function sweepReplies(knownRecipients) {
  const imap = freshImap();
  const newlySuppressed = [];
  const replies = [];
  try {
    await imap.connect();
    const lock = await imap.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - 30 * 86400000);
      const cand = [];
      for await (const msg of imap.fetch('1:*', { envelope: true, uid: true })) {
        const d = msg.envelope?.date ? new Date(msg.envelope.date) : null;
        if (d && d < since) continue;
        const from = ((msg.envelope?.from?.[0]?.address) || '').toLowerCase();
        if (!from || !knownRecipients.has(from)) continue;
        if (/mailer-daemon|postmaster|maildelivery|no-?reply/i.test(from)) continue;
        cand.push({ uid: msg.uid, from, subject: msg.envelope?.subject || '' });
      }
      for (const c of cand.slice(0, 100)) {
        let text = '';
        try {
          const { content } = await imap.download(String(c.uid), undefined, { uid: true });
          for await (const chunk of content) { text += chunk.toString('utf8'); if (text.length > 100000) break; }
        } catch { /* subject-only classification */ }
        if (OPTOUT_RE.test(`${c.subject}\n${text}`)) {
          if (!suppressed.has(c.from)) { suppressed.add(c.from); newlySuppressed.push(c.from); }
        } else {
          replies.push({ from: c.from, subject: c.subject });
        }
      }
    } finally { lock.release(); }
    await imap.logout();
  } catch (e) { console.error('reply sweep error (continuing):', e.message); }
  if (newlySuppressed.length && !DRY) newlySuppressed.forEach((t) => appendFileSync(SUPPRESS, `${t}  optout  ${new Date().toISOString()}\n`));
  if (newlySuppressed.length) { await removeDraftsFor(new Set(newlySuppressed)); console.log('opt-out -> suppressed, draft removed:', newlySuppressed.join(', ')); }
  return { newlySuppressed, replies };
}

// Proactive deliverability: does this address's domain accept mail? MX record, or
// an A record as fallback (some small domains receive on A). Transient DNS errors
// are treated as deliverable so we never false-skip a good lead. Cached per domain.
const mxCache = new Map();
async function deliverable(email) {
  const domain = (email.split('@')[1] || '').toLowerCase();
  if (!domain) return false;
  if (mxCache.has(domain)) return mxCache.get(domain);
  let ok = true;
  try {
    const mx = await resolveMx(domain);
    ok = Array.isArray(mx) && mx.length > 0;
    if (!ok) { try { const a = await resolve4(domain); ok = Array.isArray(a) && a.length > 0; } catch { ok = false; } }
  } catch (e) {
    if (e && (e.code === 'ENOTFOUND' || e.code === 'ENODATA')) {
      try { const a = await resolve4(domain); ok = Array.isArray(a) && a.length > 0; } catch { ok = false; }
    } else { ok = true; } // transient (ESERVFAIL/ETIMEOUT) -> don't punish the lead
  }
  mxCache.set(domain, ok);
  return ok;
}

// ---- main ----
const sentTos = await getSentTos();
await sweepBounces(new Set([...sentTos, ...queueTos]));

// GOOD sends = logged sends whose address never bounced. Log timestamps are
// ISO/UTC — convert to LOCAL date so evening runs don't straddle midnight.
const localDay = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-CA'); };
const logEntries = readLines(LOG).map((l) => ({ ts: localDay(l.split(/\s+/)[0]), to: (l.split(/\s+/)[1] || '').toLowerCase() }));
const goodAllTime = logEntries.filter((e) => !bounced.has(e.to)).length;
const goodToday = logEntries.filter((e) => e.ts === today && !bounced.has(e.to)).length;
const loggedTos = new Set(logEntries.map((e) => e.to).filter(Boolean));

// Opt-out / reply sweep across everyone we've actually emailed.
const { newlySuppressed, replies } = await sweepReplies(new Set([...sentTos, ...loggedTos]));

// email -> town, so the queue can be interleaved ACROSS towns by priority
// (population + current users; see aggregator/town-priority.mjs) — one lead per
// town per pass, so every batch spans many markets while leading with the towns
// that matter most.
const townByEmail = {};
try {
  for (const b of JSON.parse(readFileSync(join(OUTREACH, 'businesses.json'), 'utf8'))) {
    townByEmail[(b.email || '').toLowerCase()] = b.town || 'Findlay';
  }
} catch { /* if unreadable, fall back to plain file order */ }
const townOf = (to) => townByEmail[to] || 'Findlay';

let weights = null;
try { weights = JSON.parse(readFileSync(join(OUTREACH, 'town-weights.json'), 'utf8')).weights; }
catch { console.log('WARN: town-weights.json missing — run aggregator/town-priority.mjs; using Findlay/Toledo-first fallback'); }
const weightOf = (town) => (weights && weights[town] != null ? weights[town] : (town === 'Findlay' ? 2 : town === 'Toledo' ? 1.5 : 0));

const eligible = () => queue.filter((d) => !sentTos.has(d.to) && !loggedTos.has(d.to) && !bounced.has(d.to) && !suppressed.has(d.to) && !skipRun.has(d.to));
const pendingList = () => orderPending(eligible(), { townOf, weightOf });

// run-report accumulators
const sentThisRun = [];
const skippedNoMx = new Set();
const sendErrors = [];
function writeReport(status) {
  if (DRY) return;
  try {
    writeFileSync(join(OUTREACH, 'last-run.json'), JSON.stringify({
      generated_at: new Date().toISOString(), status, et: `${etDay} ${etHour}:00`, inWindow,
      quota, goodToday, goodAllTime, bouncedTotal: bounced.size, suppressedTotal: suppressed.size,
      pending: pendingList().length, sentThisRun, skippedNoMx: [...skippedNoMx], sendErrors,
      newlySuppressed, replies,
    }, null, 2) + '\n');
  } catch { /* non-fatal */ }
}

if (goodAllTime + bounced.size >= 10 && bounced.size / Math.max(goodAllTime + bounced.size, 1) > 0.15) {
  console.error(`ALERT: bounce rate ${bounced.size}/${goodAllTime + bounced.size} exceeds 15% — sending PAUSED. Review list quality before resuming.`);
  writeReport('paused-bounce-rate');
  process.exit(2);
}

const ramp = goodAllTime < 15 ? 5 : goodAllTime < 40 ? 8 : 10;
const quota = Math.min(ramp, Number(args.limit) || ramp);
let need = Math.max(0, quota - goodToday);

if (replies.length) {
  console.log(`\nREPLY — review (${replies.length}):`);
  for (const r of replies) console.log(`  ${r.from}  "${String(r.subject).slice(0, 60)}"`);
  console.log('');
}
console.log(`queue ${queue.length} · good all-time ${goodAllTime} · good today ${goodToday}/${quota} · bounced ${bounced.size} · suppressed ${suppressed.size} · pending ${pendingList().length} · sending now ${Math.min(need, pendingList().length)}${DRY ? ' DRY' : ''}`);

if (need === 0) { console.log('daily quota already met with good sends — nothing to do.'); writeReport('quota-met'); process.exit(0); }
if (DRY) { pendingList().slice(0, need).forEach((d) => console.log('  would send:', d.subject, '->', d.to)); process.exit(0); }
if (!inWindow && !FORCE) {
  console.log(`outside send window (now ${etDay} ${etHour}:00 ET; window ${SEND_DAYS.join('/')} ${SEND_START}:00-${SEND_END}:00 ET). Sweeps ran; no emails sent. Use --force or SEND_ANYTIME=1 to override.`);
  writeReport('outside-window');
  process.exit(0);
}

const smtp = nodemailer.createTransport({ host: 'smtp.zoho.com', port: 465, secure: true, auth: { user: USER, pass: PASS } });
try { await smtp.verify(); } catch (e) { console.error('WARNING: SMTP verify failed (will still attempt sends):', e.message); }

// Build a batch of up to n deliverable, MX-checked recipients.
async function buildBatch(n) {
  const chosen = [];
  for (const d of pendingList()) {
    if (chosen.length >= n) break;
    if (await deliverable(d.to)) chosen.push(d);
    else { skippedNoMx.add(d.to); skipRun.add(d.to); console.log('skip (no MX/A for domain):', d.to); }
  }
  return chosen;
}

// Send one message with a single retry on transient failure.
async function sendOne(d) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await smtp.sendMail({ from: `Local Loop <${USER}>`, to: d.to, subject: d.subject, text: d.body });
    } catch (e) {
      console.error(`send failed (attempt ${attempt}/2) ${d.to}: ${e.message}`);
      if (attempt < 2) await sleep(5000);
    }
  }
  return null;
}

let round = 0;
while (need > 0 && round <= TOPUP_ROUNDS) {
  const batch = await buildBatch(need);
  if (!batch.length) { console.log('queue exhausted (no deliverable pending).'); break; }
  if (round > 0) console.log(`top-up round ${round}: replacing ${batch.length} send(s)`);
  for (let i = 0; i < batch.length; i++) {
    const d = batch[i];
    const info = await sendOne(d);
    if (!info) { sendErrors.push(d.to); skipRun.add(d.to); continue; }
    appendFileSync(LOG, `${new Date().toISOString()}  ${d.to}  ${d.subject}  ${info.messageId}\n`);
    sentTos.add(d.to); sentThisRun.push(d.to);
    console.log('sent:', d.subject, '->', d.to);
    if (i < batch.length - 1) await sleep(45000 + Math.floor(Math.random() * 75000));
  }
  await sleep(GRACE_MS);
  const newly = await sweepBounces(new Set(batch.map((d) => d.to)));
  need = batch.filter((d) => newly.includes(d.to)).length; // top up only true bounces
  round++;
}

const finalGood = readLines(LOG).filter((l) => localDay(l.split(/\s+/)[0]) === today && !bounced.has((l.split(/\s+/)[1] || '').toLowerCase())).length;
writeReport('sent');
console.log(`done. good sends today: ${finalGood}/${quota}.` + (skippedNoMx.size ? ` (skipped ${skippedNoMx.size} dead-domain)` : '') + (sendErrors.length ? ` (${sendErrors.length} send error[s])` : ''));
