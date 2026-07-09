// Watch localloop@ for replies to the 28 public-records requests (sent Jul 9,
// 2026) asking for mobile food vendor rosters. Matches senders from the offices
// in records-contacts.json (by domain) or roster-ish subjects, saves any
// attachments to outreach/rosters/, and prints a JSON summary of NEW replies
// (tracked in rosters-seen.json so each reply reports once).
//
//   node check-rosters.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ImapFlow } from 'imapflow';

const HERE = join(dirname(dirname(fileURLToPath(import.meta.url))), 'outreach');
const ROOT = dirname(HERE);
const env = readFileSync(join(ROOT, '.env'), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();

const contacts = JSON.parse(readFileSync(join(HERE, 'records-contacts.json'), 'utf8'));
const domains = new Set(
  contacts.filter((c) => c.email).map((c) => c.email.split('@')[1].toLowerCase())
);
const officeByDomain = {};
for (const c of contacts.filter((c) => c.email)) {
  officeByDomain[c.email.split('@')[1].toLowerCase()] = { office: c.office, covers: c.covers };
}
const SUBJECT_RE = /records request|mobile food|vendor list|food truck|FSO|food service operation/i;

const seenFile = join(HERE, 'rosters-seen.json');
const seen = existsSync(seenFile) ? JSON.parse(readFileSync(seenFile, 'utf8')) : [];
const seenIds = new Set(seen.map((s) => s.messageId));
const rostersDir = join(HERE, 'rosters');
mkdirSync(rostersDir, { recursive: true });

const client = new ImapFlow({
  host: 'imap.zoho.com', port: 993, secure: true,
  auth: { user: g('ZOHO_SMTP_USER'), pass: g('ZOHO_SMTP_PASS') },
  logger: false,
});

const fresh = [];
await client.connect();
const lock = await client.getMailboxLock('INBOX');
try {
  const uids = await client.search({ since: new Date('2026-07-09') });
  for (const uid of uids || []) {
    const msg = await client.fetchOne(uid, { envelope: true, bodyStructure: true });
    const from = msg.envelope?.from?.[0]?.address?.toLowerCase() || '';
    const domain = from.split('@')[1] || '';
    const subject = msg.envelope?.subject || '';
    const isMatch = domains.has(domain) || SUBJECT_RE.test(subject);
    if (!isMatch || seenIds.has(msg.envelope.messageId)) continue;

    // Save attachments (rosters usually arrive as PDF/XLSX/CSV).
    const saved = [];
    const walk = (node, path = '') => {
      if (!node) return;
      if (node.disposition === 'attachment' && node.dispositionParameters?.filename) {
        saved.push({ part: path || node.part, filename: node.dispositionParameters.filename });
      }
      (node.childNodes || []).forEach((c2) => walk(c2, c2.part));
    };
    walk(msg.bodyStructure);
    const files = [];
    for (const a of saved) {
      try {
        const { content } = await client.download(uid, a.part);
        const chunks = [];
        for await (const ch of content) chunks.push(ch);
        const safe = a.filename.replace(/[^\w.\- ]+/g, '_');
        const dest = join(rostersDir, `${domain}-${safe}`);
        writeFileSync(dest, Buffer.concat(chunks));
        files.push(dest);
      } catch { /* attachment download is best-effort */ }
    }

    const info = officeByDomain[domain] || { office: from, covers: 'unknown' };
    const entry = {
      messageId: msg.envelope.messageId, from, subject,
      date: msg.envelope.date, office: info.office, covers: info.covers, files,
    };
    fresh.push(entry);
    seen.push(entry);
  }
} finally {
  lock.release();
  await client.logout();
}
writeFileSync(seenFile, JSON.stringify(seen, null, 1));
console.log(JSON.stringify({ newReplies: fresh.length, replies: fresh, totalSeen: seen.length }, null, 1));
