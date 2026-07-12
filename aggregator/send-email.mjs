// Send email as localloop@localloop.io via Zoho SMTP.
//
// Usage:
//   node scripts/send-email.mjs --to=someone@example.com --subject="Hi" --body="Plain text body"
//   node scripts/send-email.mjs --to=a@b.com --subject="Hi" --file=path/to/body.txt
//   echo "body" | node scripts/send-email.mjs --to=a@b.com --subject="Hi"
//
// Optional: --replyto=, --cc=, --dry-run (print, send nothing)
// Creds: ZOHO_SMTP_USER / ZOHO_SMTP_PASS in FindlayEvents/.env (gitignored;
// the pass is a revocable Zoho app password).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import nodemailer from 'nodemailer';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const env = readFileSync(join(ROOT, '.env'), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const USER = g('ZOHO_SMTP_USER');
const PASS = g('ZOHO_SMTP_PASS');
if (!USER || !PASS) {
  console.error('Missing ZOHO_SMTP_USER / ZOHO_SMTP_PASS in .env');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const raw = a.replace(/^--/, '');
    const i = raw.indexOf('=');
    return i === -1 ? [raw, true] : [raw.slice(0, i), raw.slice(i + 1)];
  })
);

if (!args.to || !args.subject) {
  console.error('Required: --to= and --subject=');
  process.exit(1);
}

let body = args.body || '';
if (!body && args.file) body = readFileSync(args.file, 'utf8');
if (!body && !process.stdin.isTTY) {
  // A scheduler/wrapper can spawn us with a piped stdin it never writes to or
  // closes; waiting for 'end' would hang forever. Use an IDLE timeout (reset on
  // every chunk): a silent pipe resolves empty after 10s and hits the loud
  // empty-body error below, a slow-but-active producer is never cut off, and a
  // producer that writes then holds the pipe open resolves with what arrived.
  body = await new Promise((res) => {
    let s = '';
    let timer = setTimeout(() => res(s), 10000);
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => res(s), 10000); };
    process.stdin.on('data', (d) => { s += d; bump(); });
    process.stdin.on('end', () => { clearTimeout(timer); res(s); });
  });
  // Close stdin so an open-but-idle pipe can't keep the process alive after the
  // send completes (the timers above are cleared, but the stream handle isn't).
  try { process.stdin.destroy(); } catch { /* already closed */ }
}
if (!body.trim()) {
  console.error('Empty body — pass --body=, --file=, or pipe stdin.');
  process.exit(1);
}

const message = {
  from: `Local Loop <${USER}>`,
  to: args.to,
  cc: args.cc || undefined,
  replyTo: args.replyto || undefined,
  subject: args.subject,
  text: body,
};

if (args['dry-run']) {
  console.log('--- DRY RUN (nothing sent) ---');
  console.log(JSON.stringify({ ...message, text: body.slice(0, 400) }, null, 2));
  process.exit(0);
}

const transport = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true,
  auth: { user: USER, pass: PASS },
});

const info = await transport.sendMail(message);
console.log('sent:', info.messageId, '->', args.to);
