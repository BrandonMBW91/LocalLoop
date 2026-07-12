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
  // closes; waiting for 'end' would hang forever. Give stdin 10s, then fall
  // through to the empty-body error below (loud non-zero exit).
  body = await Promise.race([
    new Promise((res) => {
      let s = '';
      process.stdin.on('data', (d) => (s += d));
      process.stdin.on('end', () => res(s));
    }),
    new Promise((res) => setTimeout(() => res(''), 10000)),
  ]);
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
