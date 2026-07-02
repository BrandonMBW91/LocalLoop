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

const client = new ImapFlow({ host: 'imap.zoho.com', port: 993, secure: true, auth: { user: USER, pass: PASS }, logger: false });
await client.connect();

// 1) who already got an email?
const sentTos = new Set();
{
  const lock = await client.getMailboxLock('Sent');
  try {
    for await (const msg of client.fetch('1:*', { envelope: true })) {
      for (const r of msg.envelope?.to || []) {
        const addr = (r.address || '').toLowerCase();
        if (ourTos.has(addr)) sentTos.add(addr);
      }
    }
  } catch { /* empty Sent is fine */ }
  finally { lock.release(); }
}

// 2) delete our injected drafts
let deleted = 0;
{
  const lock = await client.getMailboxLock('Drafts');
  try {
    const doomed = [];
    for await (const msg of client.fetch('1:*', { envelope: true, uid: true })) {
      const to = (msg.envelope?.to?.[0]?.address || '').toLowerCase();
      if (ourTos.has(to)) doomed.push(msg.uid);
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
