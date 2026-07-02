// Upload every outreach draft into the Zoho "Drafts" folder via IMAP so they
// can be reviewed (and sent) one by one from the mail client.
//
//   node zoho-drafts.mjs            (from aggregator/)
//
// Creds: ZOHO_SMTP_USER / ZOHO_SMTP_PASS in ../.env (Mail Lite app password;
// IMAP must be enabled: Zoho Mail -> Settings -> Mail Accounts -> IMAP Access).

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

function toMime(txt) {
  const lines = txt.split(/\r?\n/);
  const to = (lines[0].match(/^TO:\s*(.+)$/) || [])[1];
  const subject = (lines[1].match(/^SUBJECT:\s*(.+)$/) || [])[1];
  const body = lines.slice(3).join('\r\n').trim() + '\r\n';
  if (!to || !subject) return null;
  const headers = [
    `From: Local Loop <${USER}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ].join('\r\n');
  return { to, subject, raw: headers + '\r\n\r\n' + body };
}

const client = new ImapFlow({
  host: 'imap.zoho.com',
  port: 993,
  secure: true,
  auth: { user: USER, pass: PASS },
  logger: false,
});

await client.connect();
let ok = 0;
for (const f of files) {
  const m = toMime(readFileSync(join(draftsDir, f), 'utf8'));
  if (!m) { console.log('skip (bad format):', f); continue; }
  await client.append('Drafts', Buffer.from(m.raw), ['\\Draft']);
  ok++;
  console.log('drafted:', m.subject, '->', m.to);
}
await client.logout();
console.log(`\n${ok} drafts uploaded to Zoho Drafts.`);
