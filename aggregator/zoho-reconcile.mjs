// Reconcile the Zoho Drafts folder with outreach/drafts/:
//   1. Read Sent folder -> which outreach recipients were already emailed
//   2. Delete previously-injected outreach drafts (matched by To+Subject set)
//   3. Re-upload fresh drafts for the NOT-yet-sent recipients only
// Run: node zoho-reconcile.mjs   (from aggregator/)

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ImapFlow } from 'imapflow';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const env = readFileSync(join(ROOT, '.env'), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const USER = g('ZOHO_SMTP_USER');
const PASS = g('ZOHO_SMTP_PASS');

const draftsDir = join(ROOT, 'outreach', 'drafts');
const files = readdirSync(draftsDir).filter((f) => /^\d+.*\.txt$/.test(f)).sort();
const readLines = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
// Suppressed/bounced leads must never get a fresh Zoho draft: an opted-out or
// dead address re-uploaded here sits one manual send-click away from a
// CAN-SPAM violation, and nothing else prunes these drafts.
const excluded = new Set([
  ...readLines(join(ROOT, 'outreach', 'suppress.txt')),
  ...readLines(join(ROOT, 'outreach', 'bounced.txt')),
].map((l) => l.split(/\s+/)[0].toLowerCase()).filter(Boolean));
const drafts = files.map((f) => {
  const txt = readFileSync(join(draftsDir, f), 'utf8');
  const lines = txt.split(/\r?\n/);
  return {
    file: f,
    to: ((lines[0].match(/^TO:\s*(.+)$/) || [])[1] || '').toLowerCase(),
    subject: (lines[1].match(/^SUBJECT:\s*(.+)$/) || [])[1] || '',
    body: lines.slice(3).join('\r\n').trim() + '\r\n',
  };
}).filter((d) => d.to && d.subject);
const ourTos = new Set(drafts.map((d) => d.to));
const ourSubjects = new Set(drafts.map((d) => d.subject));

const client = new ImapFlow({ host: 'imap.zoho.com', port: 993, secure: true, auth: { user: USER, pass: PASS }, logger: false });
await client.connect();

// 1) who already got an email? Seed from the local sent-log FIRST (same source
// send-queue trusts), so an IMAP hiccup can never read as "nobody was sent" —
// that fail-open would re-upload drafts for already-emailed leads.
const sentTos = new Set(
  readLines(join(ROOT, 'outreach', 'sent-log.txt'))
    .map((l) => (l.split(/\s+/)[1] || '').toLowerCase())
    .filter((t) => ourTos.has(t))
);
{
  const lock = await client.getMailboxLock('Sent');
  try {
    for await (const msg of client.fetch('1:*', { envelope: true })) {
      for (const r of msg.envelope?.to || []) {
        const addr = (r.address || '').toLowerCase();
        if (ourTos.has(addr)) sentTos.add(addr);
      }
    }
  } catch (e) {
    // A Sent-folder ERROR (vs a legitimately empty folder, which just yields
    // zero matches above) must abort: continuing would delete + re-upload
    // drafts against incomplete knowledge of what was sent.
    console.error('Sent-folder scan failed — aborting reconcile:', e.message);
    await client.logout().catch(() => {});
    process.exit(1);
  } finally { lock.release(); }
}

// 2) delete our injected drafts
let deleted = 0;
{
  const lock = await client.getMailboxLock('Drafts');
  try {
    const doomed = [];
    for await (const msg of client.fetch('1:*', { envelope: true, uid: true })) {
      const to = (msg.envelope?.to?.[0]?.address || '').toLowerCase();
      // To AND Subject (as the header promises): a hand-written personal draft
      // to a lead must never be destroyed — only our injected template drafts.
      if (ourTos.has(to) && ourSubjects.has(msg.envelope?.subject || '')) doomed.push(msg.uid);
    }
    if (doomed.length) {
      await client.messageDelete(doomed, { uid: true });
      deleted = doomed.length;
    }
  } finally { lock.release(); }
}

// 3) upload fresh drafts for unsent recipients
let uploaded = 0;
for (const d of drafts) {
  if (sentTos.has(d.to)) { console.log('already sent, skipping:', d.to); continue; }
  if (excluded.has(d.to)) { console.log('suppressed/bounced, skipping:', d.to); continue; }
  const raw = [
    `From: Local Loop <${USER}>`,
    `To: ${d.to}`,
    `Subject: ${d.subject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    d.body,
  ].join('\r\n');
  await client.append('Drafts', Buffer.from(raw), ['\\Draft']);
  uploaded++;
}
await client.logout();
console.log(`\nSent already: ${sentTos.size} · old drafts removed: ${deleted} · fresh drafts uploaded: ${uploaded}`);
