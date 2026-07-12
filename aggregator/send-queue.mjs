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
//   • Follow-ups: a second-touch nudge auto-activates once warmed up (>= 40 good
//     sends, the ramp ceiling) with a 6-day delay, to anyone who hasn't replied
//     (replied.txt) / opted out / bounced. Override with OUTREACH_FOLLOWUP_DAYS
//     (0 forces off, N sets the delay) or OUTREACH_FOLLOWUP_ACTIVATE_AT. They
//     share the daily quota (sent before new first-touches) so total volume stays
//     inside the warm-up. Drafts live in outreach/followups/.
//   • Circuit breaker: >15% bounce rate (min 10 sent) pauses everything with ALERT.
//   • Writes outreach/last-run.json each run for observability.

import { readFileSync, writeFileSync, readdirSync, appendFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveMx, resolve4 } from 'node:dns/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { createHash } from 'node:crypto';
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
// Gap between individual sends. Widened from the old 45-120s burst (a day's whole
// batch fired inside ~13 min, which reads machine-like) to spread sends across the
// window. Actual gap is SEND_GAP_MS + up to SEND_GAP_MS jitter (default 2.5-5 min).
// Lower OUTREACH_SEND_GAP_MS if a scheduled run risks timing out.
const SEND_GAP_MS = Math.max(0, Number(process.env.OUTREACH_SEND_GAP_MS || g('OUTREACH_SEND_GAP_MS') || 150000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OUTREACH = join(ROOT, 'outreach');
const LOG = join(OUTREACH, 'sent-log.txt');
const BOUNCED = join(OUTREACH, 'bounced.txt');
const SUPPRESS = join(OUTREACH, 'suppress.txt');
const SEED_LOG = join(OUTREACH, 'seed-log.txt');
const SLUG_MAP = join(OUTREACH, 'click-slugs.json');
// Seed-inbox deliverability test: on each real send run we also send a copy of a
// representative draft to mailboxes WE own (a Gmail, an Outlook, a Yahoo) so we can
// eyeball inbox vs spam placement — the one thing a pixel/link can't answer (a
// spam-foldered message never fires a beacon). These never count toward the
// quota/ramp and are logged separately (seed-log.txt) from real leads.
const SEED_INBOXES = (process.env.OUTREACH_SEED_INBOXES || g('OUTREACH_SEED_INBOXES') || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter((s) => /@/.test(s));
// Tracked links: rewrite the signature localloop.io -> localloop.io/for/<slug> so a
// click gets logged (see the outreach-click edge function). OFF by default — the
// clean first-touch reads like a neighbor, not a tracked blast. Turn on
// (OUTREACH_TRACK_LINKS=1) only for cohorts/touches where a link is acceptable.
const TRACK_LINKS = (process.env.OUTREACH_TRACK_LINKS || g('OUTREACH_TRACK_LINKS')) === '1';

// CAN-SPAM guard: refuse to send until a real physical postal address is set
// (15 USC 7704(a)(5) requires one in every commercial email). Blocks the whole
// run — including the scheduled 8am job — while mailing-address.txt is the
// placeholder, so no non-compliant mail goes out. Set the address, re-run the
// assemblers, and this clears itself.
{
  const addrFile = join(OUTREACH, 'mailing-address.txt');
  const addr = existsSync(addrFile) ? readFileSync(addrFile, 'utf8').trim() : '';
  if (!addr || /^\[SET MAILING ADDRESS/i.test(addr)) {
    console.log('HELD: outreach/mailing-address.txt is not set — CAN-SPAM requires a physical postal address in every email. No mail sent. Set the address, run node outreach/assemble-drafts.cjs and node outreach/assemble-truck-drafts.mjs --round2 (and again without --round2 for round 1), then re-run.');
    process.exit(0);
  }
}
// Machine guard: send ONLY from the automation host (the desktop). The daily
// quota + warm-up ramp are derived from the machine-local, gitignored sent-log,
// which is NOT synced across machines — so running the sender on a second machine
// (the laptop) the same day would double the day's volume and reset the warm-up
// ramp to 5/day. Refuse unless the hostname matches OUTREACH_HOST (default
// BrandonPC, the desktop) or --any-host is passed. Sweeps below never run because
// we exit first; that's intended (they mutate shared Zoho state too).
{
  const wantHost = (process.env.OUTREACH_HOST || g('OUTREACH_HOST') || 'BrandonPC').trim();
  const thisHost = os.hostname();
  if (!args['any-host'] && thisHost.toLowerCase() !== wantHost.toLowerCase()) {
    console.log(`HELD: outreach sends only from the automation host (${wantHost}); this machine is ${thisHost}. The daily quota + warm-up ramp live in the gitignored sent-log, so sending here would double volume and reset the ramp. Set OUTREACH_HOST=${thisHost} (in .env) or pass --any-host to override.`);
    process.exit(0);
  }
}
// ---- run lock: one real sender at a time ----
// Every quota/dedupe input (sent-log, Zoho Sent folder, follow-up log) is
// snapshotted ONCE at startup, so a second concurrent run (cron + a manual run,
// or a stacked scheduler launch) computes the same shortfall and sends the SAME
// top-priority leads the same email. A pid lockfile serializes real runs; a
// lock older than 2h is a crashed run and is taken over. DRY runs skip it.
const LOCK = join(OUTREACH, '.send-lock');
if (!DRY) {
  const acquire = () => writeFileSync(LOCK, String(process.pid), { flag: 'wx' });
  try {
    acquire();
  } catch (e) {
    if (e.code === 'EEXIST') {
      let ageMs = 0;
      try { ageMs = Date.now() - statSync(LOCK).mtimeMs; } catch { ageMs = Infinity; }
      if (ageMs < 2 * 3600 * 1000) {
        console.log(`HELD: another send-queue run appears active (outreach/.send-lock is ${Math.round(ageMs / 60000)}m old). Exiting so we don't double-send. Delete the lock file if this is wrong.`);
        process.exit(0);
      }
      // Race-safe takeover: delete, then re-create EXCLUSIVELY — when two
      // stacked launches both see the same stale lock, only one wins the wx
      // create; the loser exits instead of both "taking over".
      console.log('stale send lock (over 2h old) — taking over.');
      try { unlinkSync(LOCK); } catch { /* the other taker removed it first */ }
      try { acquire(); }
      catch { console.log('HELD: another process won the stale-lock takeover. Exiting.'); process.exit(0); }
    } else { throw e; }
  }
  // Heartbeat: refresh the lock's mtime while alive, so a legitimately long run
  // (raised quota x 2.5-5 min pacing can exceed 2h) is never mistaken for a
  // stale lock by a second launch. unref'd so it can't hold the process open.
  const hb = setInterval(() => { try { writeFileSync(LOCK, String(process.pid)); } catch { /* non-fatal */ } }, 10 * 60 * 1000);
  hb.unref();
  const releaseLock = () => {
    // Only remove the lock if this process still owns it — after a stale
    // takeover the file belongs to the taker, and blindly unlinking would
    // reopen the door to a third concurrent run.
    try { if (readFileSync(LOCK, 'utf8').trim() === String(process.pid)) unlinkSync(LOCK); } catch { /* already gone */ }
  };
  process.on('exit', releaseLock);
  process.on('SIGINT', () => process.exit(130));
  process.on('SIGTERM', () => process.exit(143));
}

const readLines = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : []);
const today = new Date().toLocaleDateString('en-CA');

// ---- send window (ET) ----
const SEND_DAYS = (process.env.OUTREACH_SEND_DAYS || g('OUTREACH_SEND_DAYS') || 'Mon,Tue,Wed,Thu,Fri,Sat').split(',').map((s) => s.trim());
// Empty-valued env lines (OUTREACH_SEND_START=) are '' — not nullish, so `??`
// defaults never applied and Number('') === 0 silently opened the window at
// midnight. Treat empty/non-numeric as unset.
const numOr = (v, dflt) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : dflt; };
const SEND_START = numOr(process.env.OUTREACH_SEND_START ?? g('OUTREACH_SEND_START'), 8);
const SEND_END = numOr(process.env.OUTREACH_SEND_END ?? g('OUTREACH_SEND_END'), 20);
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

// Second-touch follow-ups. Delay in days is computed after we know the warm-up
// state (see FOLLOWUP_DAYS below): auto-on once the domain is warmed up, or an
// explicit OUTREACH_FOLLOWUP_DAYS overrides. Follow-ups share the daily quota
// (sent BEFORE new first-touches) so total volume stays inside the warm-up.
const FOLLOWUP_LOG = join(OUTREACH, 'followup-log.txt');
const REPLIED = join(OUTREACH, 'replied.txt');
const replied = new Set(readLines(REPLIED).map((l) => l.split(/\s+/)[0].toLowerCase()));
// Follow-up drafts (parallel to drafts/, keyed by recipient), written by assemble-drafts.cjs.
const followupByEmail = {};
try {
  const fdir = join(OUTREACH, 'followups');
  for (const f of readdirSync(fdir).filter((x) => /^\d+.*\.txt$/.test(x))) {
    const lines = readFileSync(join(fdir, f), 'utf8').split(/\r?\n/);
    const to = ((lines[0].match(/^TO:\s*(.+)$/) || [])[1] || '').toLowerCase();
    const subject = (lines[1].match(/^SUBJECT:\s*(.+)$/) || [])[1] || '';
    const body = lines.slice(3).join('\n').trim() + '\n';
    if (to && subject && body.trim().length > 20) followupByEmail[to] = { subject, body };
  }
} catch { /* no followups dir yet */ }

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
          // Boundary-anchored match, not includes(): an address that is a
          // substring of another (ann@cafe.com inside joann@cafe.com in the
          // same notice) must not blocklist the wrong lead.
          const lower = text.toLowerCase();
          const found = [...knownTos].filter((t) => {
            const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Trailing guard also rejects a dot-continued domain label
            // (ann@cafe.com inside ann@cafe.com.mx) while still allowing an
            // end-of-sentence period.
            return new RegExp(`(^|[^a-z0-9._%+-])${esc}(?![a-z0-9-]|\\.[a-z0-9])`, 'i').test(lower);
          });
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

// CRITICAL guard: classify only the text the SENDER actually wrote. Every draft
// we send ends with the PS 'Reply "no thanks" and I won't email you again.',
// and nearly all mail clients quote the original under a reply — so testing the
// raw message classified EVERY genuine reply (even "tell me more!") as an
// opt-out, permanently suppressing interested leads and hiding their replies.
// Strategy: drop the MIME headers, drop ">"-quoted lines, cut at the standard
// reply-attribution markers (Gmail/Apple "On ... wrote:", Outlook's From:-block
// and dividers), and cut HTML alternatives at the first blockquote/gmail_quote.
// Failure direction is deliberately safe: if we can't be sure it's an opt-out
// from the sender's own words, the reply is SURFACED for a human instead of
// silently suppressed.
function replyOwnText(raw) {
  let s = String(raw || '');
  const headerEnd = s.search(/\r?\n\r?\n/);           // end of top-level headers
  if (headerEnd >= 0) s = s.slice(headerEnd + 2);
  s = s.replace(/=\r?\n/g, '');                        // quoted-printable soft breaks
  s = s.replace(/<blockquote[\s\S]*$/i, '');           // HTML quoted original
  s = s.replace(/<div[^>]*class="gmail_quote[\s\S]*$/i, '');
  s = s.split(/^On .{0,300} wrote:\s*$/m)[0];          // Gmail/Apple attribution
  s = s.split(/^-{2,}\s*Original Message\s*-{2,}\s*$/mi)[0]; // Outlook classic
  s = s.split(/^\s*_{6,}\s*$/m)[0];                    // Outlook divider
  s = s.split(/^\s*From:\s.+$/m)[0];                   // Outlook top-quote header block
  return s
    .split(/\r?\n/)
    .filter((l) => !/^\s*>/.test(l))                   // ">"-quoted lines
    .join('\n');
}

// Scan INBOX for genuine replies from people we emailed. Opt-outs -> suppress.txt
// (+ draft removed). Everything else is surfaced for a human to read. Returns
// { newlySuppressed, replies }.
async function sweepReplies(knownRecipients, ourMsgIds = new Set(), msgIdMap = {}) {
  const imap = freshImap();
  const newlySuppressed = [];
  const newReplied = [];
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
        const inReplyTo = (msg.envelope?.inReplyTo || '').trim();
        // A message counts as a reply if it's FROM a lead we mailed, OR it threads
        // to one of our sends via In-Reply-To (catches owners replying from a
        // personal address). The latter is resolved back to the mailed lead.
        const known = from && knownRecipients.has(from);
        const threaded = inReplyTo && ourMsgIds.has(inReplyTo);
        if (!known && !threaded) continue;
        if (/mailer-daemon|postmaster|maildelivery|no-?reply/i.test(from)) continue;
        const recipient = known ? from : (msgIdMap[inReplyTo] || from);
        cand.push({ uid: msg.uid, from, recipient, subject: msg.envelope?.subject || '' });
      }
      for (const c of cand.slice(0, 100)) {
        let text = '';
        try {
          const { content } = await imap.download(String(c.uid), undefined, { uid: true });
          for await (const chunk of content) { text += chunk.toString('utf8'); if (text.length > 100000) break; }
        } catch { /* subject-only classification */ }
        if (OPTOUT_RE.test(`${c.subject}\n${replyOwnText(text)}`)) {
          if (!suppressed.has(c.recipient)) { suppressed.add(c.recipient); newlySuppressed.push(c.recipient); }
        } else {
          replies.push({ from: c.from, subject: c.subject });
          if (!replied.has(c.recipient)) { replied.add(c.recipient); newReplied.push(c.recipient); }
        }
      }
    } finally { lock.release(); }
    await imap.logout();
  } catch (e) { console.error('reply sweep error (continuing):', e.message); }
  if (newlySuppressed.length && !DRY) newlySuppressed.forEach((t) => appendFileSync(SUPPRESS, `${t}  optout  ${new Date().toISOString()}\n`));
  if (newReplied.length && !DRY) newReplied.forEach((t) => appendFileSync(REPLIED, `${t}  ${new Date().toISOString()}\n`));
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

// Map each Message-ID we sent -> the lead we mailed, so a reply arriving from a
// DIFFERENT address (an owner's personal Gmail, not the info@ we hit) can still be
// tied back to that lead via its In-Reply-To header. Without this, the reply sweep
// only matched an exact From and silently dropped personal-address replies —
// inflating the "0 replies" count. Message-ID is the last whitespace token logged.
const msgIdToRecipient = {};
for (const p of [LOG, FOLLOWUP_LOG]) {
  for (const line of readLines(p)) {
    const parts = line.split(/\s+/);
    const to = (parts[1] || '').toLowerCase();
    const mid = (parts[parts.length - 1] || '').trim();
    if (to && /^<.+>$/.test(mid)) msgIdToRecipient[mid] = to;
  }
}
const ourMsgIds = new Set(Object.keys(msgIdToRecipient));

// Follow-ups auto-activate once the domain is warmed up — at FOLLOWUP_ACTIVATE_AT
// good sends (default 40, the same point the daily ramp reaches its ceiling) —
// using a 6-day delay. An explicit OUTREACH_FOLLOWUP_DAYS overrides in either
// direction: set 0 to force off, or any N to set the delay regardless of warm-up.
const FU_ENV = process.env.OUTREACH_FOLLOWUP_DAYS ?? g('OUTREACH_FOLLOWUP_DAYS');
const FU_ACTIVATE_AT = Number(process.env.OUTREACH_FOLLOWUP_ACTIVATE_AT || g('OUTREACH_FOLLOWUP_ACTIVATE_AT') || 40);
// Number.isFinite guard: a non-numeric value yielded NaN, which slipped past
// the `<= 0` off-switch and turned dueCut into 'Invalid Date' — making every
// first touch instantly "due" by string comparison.
const fuNum = Number(FU_ENV);
const FOLLOWUP_DAYS = (FU_ENV != null && FU_ENV !== '' && Number.isFinite(fuNum)) ? Math.max(0, fuNum) : (goodAllTime >= FU_ACTIVATE_AT ? 6 : 0);

// First-touch day per email (sent-log.txt holds first touches only; follow-ups
// have their own log). Used to decide when a follow-up is due.
const firstTouchDay = {};
for (const e of logEntries) { if (e.to && e.ts && (!firstTouchDay[e.to] || e.ts < firstTouchDay[e.to])) firstTouchDay[e.to] = e.ts; }
// Follow-ups already sent (own log) + how many went out today (they share quota).
const fuEntries = readLines(FOLLOWUP_LOG).map((l) => ({ ts: localDay(l.split(/\s+/)[0]), to: (l.split(/\s+/)[1] || '').toLowerCase() }));
// Crash net: an intent line is appended BEFORE each follow-up's SMTP send (see
// the send loop), and intents count as "followed up" here — so a crash between
// sendMail success and the FOLLOWUP_LOG append can never re-send the same
// follow-up on the rerun. Failure direction: a crash mid-send costs one MISSED
// follow-up, never a duplicate. (First touches are already rerun-safe via the
// Zoho Sent-folder check.)
const FU_INTENT = join(OUTREACH, 'followup-intent.txt');
const followedUp = new Set([
  ...fuEntries.map((e) => e.to).filter(Boolean),
  ...readLines(FU_INTENT).map((l) => (l.split(/\s+/)[1] || '').toLowerCase()).filter(Boolean),
]);
const followupsToday = fuEntries.filter((e) => e.ts === today).length;
const dueCut = new Date(Date.now() - FOLLOWUP_DAYS * 86400000).toLocaleDateString('en-CA');

// Opt-out / reply sweep across everyone we've actually OUTREACHED (the sent-log),
// not the whole Zoho Sent folder — the latter also holds one-off mail like the
// public-records requests, whose office replies would otherwise clutter the
// "REPLY — review" list (they're handled by check-rosters.mjs instead).
const { newlySuppressed, replies } = await sweepReplies(loggedTos, ourMsgIds, msgIdToRecipient);

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

// First-touch: never-emailed, not bounced/opted-out/errored-this-run.
const eligibleFirst = () => queue.filter((d) => !sentTos.has(d.to) && !loggedTos.has(d.to) && !bounced.has(d.to) && !suppressed.has(d.to) && !skipRun.has(d.to));
// Follow-up (opt-in): got a first touch >= FOLLOWUP_DAYS ago, no reply, no opt-out,
// no bounce, not already followed up.
const eligibleFollowups = () => (FOLLOWUP_DAYS <= 0 ? [] : Object.keys(followupByEmail)
  .filter((to) => loggedTos.has(to) && firstTouchDay[to] && firstTouchDay[to] <= dueCut
    && !followedUp.has(to) && !replied.has(to) && !bounced.has(to) && !suppressed.has(to) && !skipRun.has(to))
  .map((to) => ({ to, subject: followupByEmail[to].subject, body: followupByEmail[to].body, kind: 'followup' })));
const orderFollowups = () => orderPending(eligibleFollowups(), { townOf, weightOf });
const orderFirst = () => orderPending(eligibleFirst().map((d) => ({ ...d, kind: 'first' })), { townOf, weightOf });
// Follow-ups first (warm leads convert better), then new first-touches — all
// inside the same daily quota so total volume never exceeds the warm-up ramp.
const pendingList = () => [...orderFollowups(), ...orderFirst()];

// run-report accumulators
const sentThisRun = [];
const skippedNoMx = new Set();
const sendErrors = [];
let seedsSent = 0;
function writeReport(status) {
  if (DRY) return;
  try {
    writeFileSync(join(OUTREACH, 'last-run.json'), JSON.stringify({
      generated_at: new Date().toISOString(), status, et: `${etDay} ${etHour}:00`, inWindow,
      quota, goodToday, goodAllTime, followupDays: FOLLOWUP_DAYS, followupsToday, followupsDue: orderFollowups().length,
      bouncedTotal: bounced.size, suppressedTotal: suppressed.size, repliedTotal: replied.size, seedsSent,
      pending: pendingList().length, sentThisRun, skippedNoMx: [...skippedNoMx], sendErrors,
      newlySuppressed, replies,
    }, null, 2) + '\n');
  } catch { /* non-fatal */ }
}

// Warm-up ramp: 5/day until 15 good sends, 8 until 40, then the mature ceiling.
// The ceiling is OUTREACH_MAX_DAILY (default 10) so it can be raised (15/20/25…)
// as reputation + DMARC allow, without a code change. Default 10 = prior behavior.
const MAX_DAILY = Math.max(1, Number(process.env.OUTREACH_MAX_DAILY || g('OUTREACH_MAX_DAILY') || 10));
// Tier from the count at the START of today: deriving it from the live all-time
// count let a second same-day run cross a ramp boundary mid-day and stack the
// next tier's quota on top of what had already gone out.
const goodBeforeToday = goodAllTime - goodToday;
const rampBase = goodBeforeToday < 15 ? 5 : goodBeforeToday < 40 ? 8 : MAX_DAILY;
const ramp = Math.min(rampBase, MAX_DAILY);
// --limit only ever LOWERS the quota. Parsed explicitly: Number('0') is falsy,
// so the old `Number(args.limit) || ramp` sent the FULL quota on --limit=0.
const limitNum = 'limit' in args ? Number(args.limit === true ? NaN : args.limit) : NaN;
const quota = Number.isFinite(limitNum) ? Math.max(0, Math.min(ramp, limitNum)) : ramp;
let need = Math.max(0, quota - goodToday - followupsToday);

// Circuit breaker — evaluated AFTER quota is initialized: it used to sit above
// the `const quota`, so writeReport's quota reference threw a TDZ error that
// its own try/catch swallowed, and last-run.json was never written exactly when
// sending paused. bounceRateTripped is re-checked mid-run by the top-up loop;
// liveSentThisRun keeps this run's delivered sends in the denominator so the
// mid-run rate isn't overestimated (startup goodAllTime alone would false-trip
// just past the boundary while bounced grows).
let liveSentThisRun = 0;
const bounceRateTripped = () => {
  const denom = goodAllTime + liveSentThisRun + bounced.size;
  return denom >= 10 && bounced.size / Math.max(denom, 1) > 0.15;
};
if (bounceRateTripped()) {
  console.error(`ALERT: bounce rate ${bounced.size}/${goodAllTime + bounced.size} exceeds 15% — sending PAUSED. Review list quality before resuming.`);
  writeReport('paused-bounce-rate');
  process.exit(2);
}

if (replies.length) {
  console.log(`\nREPLY — review (${replies.length}):`);
  for (const r of replies) console.log(`  ${r.from}  "${String(r.subject).slice(0, 60)}"`);
  console.log('');
}
const fuDue = orderFollowups().length;
console.log(`queue ${queue.length} · good all-time ${goodAllTime} · today ${goodToday + followupsToday}/${quota} (${followupsToday} follow-up) · bounced ${bounced.size} · suppressed ${suppressed.size} · replied ${replied.size}` + (FOLLOWUP_DAYS ? ` · follow-ups due ${fuDue}` : ' · follow-ups OFF') + ` · pending ${pendingList().length} · sending now ${Math.min(need, pendingList().length)}${DRY ? ' DRY' : ''}`);

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

// --- seed-inbox probe + tracked links ------------------------------------
let slugMap = {};
try { slugMap = JSON.parse(readFileSync(SLUG_MAP, 'utf8')); } catch { slugMap = {}; }
const townSlug = (t) => (t || 'ohio').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Per-lead tracked-link slug: <town>-<8 hex of email>, deterministic so a lead
// always maps to the same slug. Persisted to click-slugs.json so the funnel can
// resolve a logged click back to the business + town.
function linkFor(email, town) {
  const slug = `${townSlug(town)}-${createHash('sha1').update(email).digest('hex').slice(0, 8)}`;
  if (!slugMap[slug]) {
    slugMap[slug] = { email, town, created: new Date().toISOString() };
    try { writeFileSync(SLUG_MAP, JSON.stringify(slugMap, null, 2)); } catch { /* non-fatal */ }
  }
  return `https://localloop.io/for/${slug}`;
}

// Send a representative draft to our own seed mailboxes so we can see inbox-vs-spam
// placement. Not counted toward quota/ramp; logged to seed-log.txt only.
async function sendSeeds(sample) {
  if (!SEED_INBOXES.length || !sample) return 0;
  let n = 0;
  for (const to of SEED_INBOXES) {
    try {
      await smtp.sendMail({
        from: `Local Loop <${USER}>`, to, subject: sample.subject, text: sample.body,
        headers: { 'List-Unsubscribe': `<mailto:${USER}?subject=unsubscribe>` },
      });
      appendFileSync(SEED_LOG, `${new Date().toISOString()}  SEED  ${to}  ${sample.subject}\n`);
      console.log(`seed -> ${to} (check inbox vs spam): "${sample.subject}"`);
      n++;
    } catch (e) { console.error(`seed send failed ${to}: ${e.message}`); }
  }
  return n;
}

// Send one message with a single retry on transient failure.
async function sendOne(d) {
  // Optional tracked link (OFF by default): rewrite the signature localloop.io to
  // the branded /for/<slug> tracker so a click is logged.
  const body = TRACK_LINKS ? d.body.replace(/^localloop\.io$/m, linkFor(d.to, townOf(d.to))) : d.body;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await smtp.sendMail({
        from: `Local Loop <${USER}>`,
        to: d.to,
        subject: d.subject,
        text: body,
        // A List-Unsubscribe header is a free trust signal to Gmail/Yahoo and lets
        // their UI offer one-click unsubscribe; the mailto reply ("unsubscribe")
        // is caught by OPTOUT_RE on the next sweep and suppressed.
        headers: { 'List-Unsubscribe': `<mailto:${USER}?subject=unsubscribe>` },
      });
    } catch (e) {
      console.error(`send failed (attempt ${attempt}/2) ${d.to}: ${e.message}`);
      if (attempt < 2) await sleep(5000);
    }
  }
  return null;
}

// Seed-inbox deliverability probe (own mailboxes; never counted toward quota).
const seedSample = orderFirst()[0] || pendingList()[0];
seedsSent = await sendSeeds(seedSample);

let round = 0;
while (need > 0 && round <= TOPUP_ROUNDS) {
  const batch = await buildBatch(need);
  if (!batch.length) { console.log('queue exhausted (no deliverable pending).'); break; }
  if (round > 0) console.log(`top-up round ${round}: replacing ${batch.length} send(s)`);
  for (let i = 0; i < batch.length; i++) {
    const d = batch[i];
    // Intent BEFORE send (crash net: a crash between sendMail success and the
    // log append must never double-send on the rerun).
    let intentLine = null;
    if (d.kind === 'followup') { intentLine = `${new Date().toISOString()}  ${d.to}`; appendFileSync(FU_INTENT, intentLine + '\n'); }
    const info = await sendOne(d);
    if (!info) {
      sendErrors.push(d.to); skipRun.add(d.to);
      // Compensate the intent on a HANDLED failure: skipRun means "pending for
      // a future run", so the intent must not permanently mark this lead as
      // followed-up. Safe to rewrite the file — the run lock is exclusive. The
      // crash-net property is preserved (a crash mid-send leaves the intent).
      if (intentLine) {
        try { writeFileSync(FU_INTENT, readLines(FU_INTENT).filter((l) => l !== intentLine).join('\n') + '\n'); }
        catch { /* worst case: one missed follow-up, never a duplicate */ }
      }
      continue;
    }
    appendFileSync(d.kind === 'followup' ? FOLLOWUP_LOG : LOG, `${new Date().toISOString()}  ${d.to}  ${d.subject}  ${info.messageId}\n`);
    liveSentThisRun++;
    sentTos.add(d.to); skipRun.add(d.to); sentThisRun.push((d.kind === 'followup' ? 'followup ' : '') + d.to);
    console.log((d.kind === 'followup' ? 'sent follow-up:' : 'sent:'), d.subject, '->', d.to);
    if (i < batch.length - 1) await sleep(SEND_GAP_MS + Math.floor(Math.random() * SEND_GAP_MS));
  }
  await sleep(GRACE_MS);
  const newly = await sweepBounces(new Set(batch.map((d) => d.to)));
  const bouncedFromBatch = batch.filter((d) => newly.includes(d.to)).length;
  liveSentThisRun = Math.max(0, liveSentThisRun - bouncedFromBatch); // bounced sends aren't "good"
  need = bouncedFromBatch; // top up only true bounces
  // Re-check the breaker with the mid-run bounces: the startup-only check let a
  // fully-bouncing list absorb the initial batch + every top-up round (up to 3x
  // quota) before the NEXT run could trip it.
  if (bounceRateTripped()) {
    console.error(`ALERT: bounce rate ${bounced.size}/${goodAllTime + bounced.size} exceeded 15% mid-run — stopping top-ups.`);
    writeReport('paused-bounce-rate');
    process.exit(2);
  }
  round++;
}

const finalGood = readLines(LOG).filter((l) => localDay(l.split(/\s+/)[0]) === today && !bounced.has((l.split(/\s+/)[1] || '').toLowerCase())).length;
const fuSent = sentThisRun.filter((s) => s.startsWith('followup ')).length;
writeReport('sent');
console.log(`done. today: ${finalGood} first-touch + ${fuSent} follow-up = ${finalGood + fuSent}/${quota}.` + (skippedNoMx.size ? ` (skipped ${skippedNoMx.size} dead-domain)` : '') + (sendErrors.length ? ` (${sendErrors.length} send error[s])` : ''));
