// Paced, reputation-safe outreach sender with bounce top-up.
//
//   node send-queue.mjs [--limit=N] [--dry-run]
//
// Behavior:
//   • Daily quota = warm-up ramp (5/day until 15 GOOD sends, 8 until 40, then 10);
//     --limit can only lower it. Bounced sends DON'T count toward quota or ramp.
//   • Day-aware and idempotent: re-running the same day only sends the shortfall
//     (quota minus today's good sends), so top-ups are safe any time.
//   • Bounce sweep before AND after sending (3-min grace): kicked addresses are
//     blocklisted (outreach/bounced.txt), their Zoho draft deleted, the bounce
//     notice moved to Trash — and a replacement is sent, up to 2 top-up rounds.
//   • Skips anyone already in the Zoho Sent folder. 45-120s jitter between sends.
//   • Circuit breaker: >15% bounce rate (min 10 sent) pauses everything with ALERT.

import { readFileSync, readdirSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const env = readFileSync(join(ROOT, '.env'), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const USER = g('ZOHO_SMTP_USER');
const PASS = g('ZOHO_SMTP_PASS');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const r = a.replace(/^--/, ''); const i = r.indexOf('=');
  return i === -1 ? [r, true] : [r.slice(0, i), r.slice(i + 1)];
}));
const DRY = Boolean(args['dry-run']);
const GRACE_MS = 3 * 60 * 1000; // wait for immediate bounces before topping up
const TOPUP_ROUNDS = 2;

const OUTREACH = join(ROOT, 'outreach');
const LOG = join(OUTREACH, 'sent-log.txt');
const BOUNCED = join(OUTREACH, 'bounced.txt');
const readLines = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : []);
const today = new Date().toLocaleDateString('en-CA');

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
}).filter((d) => d.to && d.subject);
const queueTos = new Set(queue.map((d) => d.to));

const bounced = new Set(readLines(BOUNCED).map((l) => l.split(/\s+/)[0].toLowerCase()));

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
  if (newly.length && !DRY) {
    newly.forEach((t) => appendFileSync(BOUNCED, `${t}  ${new Date().toISOString()}\n`));
    // remove their Zoho drafts
    const lock = await imap.getMailboxLock('Drafts');
    try {
      const doomed = [];
      for await (const msg of imap.fetch('1:*', { envelope: true, uid: true })) {
        const to = ((msg.envelope?.to?.[0]?.address) || '').toLowerCase();
        if (bounced.has(to)) doomed.push(msg.uid);
      }
      if (doomed.length) await imap.messageDelete(doomed, { uid: true });
    } catch { /* fine */ } finally { lock.release(); }
  }
  await imap.logout();
  if (newly.length) console.log('bounced -> blocklisted, draft removed, notice trashed:', newly.join(', '));
  return newly;
}

// ---- main ----
const sentTos = await getSentTos();
await sweepBounces(new Set([...sentTos, ...queueTos]));

// GOOD sends = logged sends whose address never bounced. Log timestamps are
// ISO/UTC — convert to LOCAL date so evening runs don't straddle midnight and
// double the daily quota.
const localDay = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-CA'); };
const logEntries = readLines(LOG).map((l) => ({ ts: localDay(l.split(/\s+/)[0]), to: (l.split(/\s+/)[1] || '').toLowerCase() }));
const goodAllTime = logEntries.filter((e) => !bounced.has(e.to)).length;
const goodToday = logEntries.filter((e) => e.ts === today && !bounced.has(e.to)).length;

if (goodAllTime + bounced.size >= 10 && bounced.size / Math.max(goodAllTime + bounced.size, 1) > 0.15) {
  console.error(`ALERT: bounce rate ${bounced.size}/${goodAllTime + bounced.size} exceeds 15% — sending PAUSED. Review list quality before resuming.`);
  process.exit(2);
}

const ramp = goodAllTime < 15 ? 5 : goodAllTime < 40 ? 8 : 10;
const quota = Math.min(ramp, Number(args.limit) || ramp);
let need = Math.max(0, quota - goodToday);

// Pending = never sent per the Sent folder AND per our local log (belt and
// suspenders: a partial IMAP fetch can't cause a re-email).
const loggedTos = new Set(logEntries.map((e) => e.to).filter(Boolean));

// email -> town, so the queue can be ordered as a solid mix that leads with the
// two markets that actually have an audience to sell (Findlay + Toledo).
const townByEmail = {};
try {
  for (const b of JSON.parse(readFileSync(join(OUTREACH, 'businesses.json'), 'utf8'))) {
    townByEmail[(b.email || '').toLowerCase()] = b.town || 'Findlay';
  }
} catch { /* if unreadable, fall back to plain file order */ }
const townOf = (to) => townByEmail[to] || 'Other';
// Round-robin Findlay, Toledo, then the rest, so each batch is roughly 3 Findlay,
// 3 Toledo, 2 other: audience markets first, without going monotone.
function mixed(list) {
  const f = list.filter((d) => townOf(d.to) === 'Findlay');
  const t = list.filter((d) => townOf(d.to) === 'Toledo');
  const o = list.filter((d) => !['Findlay', 'Toledo'].includes(townOf(d.to)));
  const out = [];
  while (f.length || t.length || o.length) {
    if (f.length) out.push(f.shift());
    if (t.length) out.push(t.shift());
    if (o.length) out.push(o.shift());
  }
  return out;
}
const pendingList = () => mixed(queue.filter((d) => !sentTos.has(d.to) && !loggedTos.has(d.to) && !bounced.has(d.to)));
console.log(`queue ${queue.length} · good all-time ${goodAllTime} · good today ${goodToday}/${quota} · bounced total ${bounced.size} · pending ${pendingList().length} · sending now ${Math.min(need, pendingList().length)}${DRY ? ' DRY' : ''}`);

if (need === 0) { console.log('daily quota already met with good sends — nothing to do.'); process.exit(0); }
if (DRY) { pendingList().slice(0, need).forEach((d) => console.log('  would send:', d.subject, '->', d.to)); process.exit(0); }

const smtp = nodemailer.createTransport({ host: 'smtp.zoho.com', port: 465, secure: true, auth: { user: USER, pass: PASS } });

let round = 0;
while (need > 0 && round <= TOPUP_ROUNDS) {
  const batch = pendingList().slice(0, need);
  if (!batch.length) { console.log('queue exhausted.'); break; }
  if (round > 0) console.log(`top-up round ${round}: replacing ${batch.length} bounced send(s)`);
  for (let i = 0; i < batch.length; i++) {
    const d = batch[i];
    const info = await smtp.sendMail({ from: `Local Loop <${USER}>`, to: d.to, subject: d.subject, text: d.body });
    appendFileSync(LOG, `${new Date().toISOString()}  ${d.to}  ${d.subject}  ${info.messageId}\n`);
    sentTos.add(d.to);
    console.log('sent:', d.subject, '->', d.to);
    if (i < batch.length - 1) await new Promise((r) => setTimeout(r, 45000 + Math.floor(Math.random() * 75000)));
  }
  // grace period, then check whether any of this round kicked back
  await new Promise((r) => setTimeout(r, GRACE_MS));
  const newly = await sweepBounces(new Set(batch.map((d) => d.to)));
  const failed = batch.filter((d) => newly.includes(d.to)).length;
  need = failed;
  round++;
}
const finalGood = readLines(LOG).filter((l) => localDay(l.split(/\s+/)[0]) === today && !bounced.has((l.split(/\s+/)[1] || '').toLowerCase())).length;
console.log(`done. good sends today: ${finalGood}/${quota}.`);
