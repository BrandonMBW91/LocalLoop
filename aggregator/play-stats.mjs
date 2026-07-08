// Pull Google Play install statistics from the developer "reports" Cloud Storage
// bucket using the service-account key (.gcp/play-service-account.json).
//
// Play Console exports monthly CSVs to gs://pubsite_prod_rev_<id>/stats/installs/.
// This finds the latest "installs overview" report for the app, decodes it
// (Play ships these as UTF-16LE with a BOM — a classic parsing gotcha), and
// prints the current install/active-device numbers.
//
// Usage:
//   node aggregator/play-stats.mjs --bucket=pubsite_prod_rev_XXXXXXXX
//   (or set PLAY_STATS_BUCKET in FindlayEvents/.env; the gs:// prefix is optional)
//
// Caveats: this data lags ~3-7 days and is NOT broken out by test track, so it
// answers "overall installs" — not "how many are in the closed test right now"
// (that stays a Play Console → Closed testing → Testers view).

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // FindlayEvents
const KEY_PATH = join(ROOT, '.gcp', 'play-service-account.json');
const PKG = 'com.michaelwilliams.localloop';

// ---- args / env ----
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const r = a.replace(/^--/, '');
    const i = r.indexOf('=');
    return i === -1 ? [r, true] : [r.slice(0, i), r.slice(i + 1)];
  })
);
const envVal = (k) => {
  try {
    const e = readFileSync(join(ROOT, '.env'), 'utf8');
    return (e.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
  } catch {
    return undefined;
  }
};
let bucket = args.bucket || envVal('PLAY_STATS_BUCKET') || '';
bucket = String(bucket).replace(/^gs:\/\//, '').replace(/\/.*$/, '').trim();
if (!bucket) {
  console.error('Need a bucket: --bucket=pubsite_prod_rev_XXXX (or PLAY_STATS_BUCKET in .env).');
  process.exit(1);
}

// ---- mint a Cloud Storage read token from the service-account key ----
const k = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
async function mintToken() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const seg =
    b64({ alg: 'RS256', typ: 'JWT' }) +
    '.' +
    b64({
      iss: k.client_email,
      scope: 'https://www.googleapis.com/auth/devstorage.read_only',
      aud: k.token_uri,
      iat: now,
      exp: now + 3600,
    });
  const sig = crypto.createSign('RSA-SHA256').update(seg).sign(k.private_key).toString('base64url');
  const r = await fetch(k.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: seg + '.' + sig,
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('token exchange failed: ' + JSON.stringify(j));
  return j.access_token;
}

const unq = (s) => String(s == null ? '' : s).replace(/^"|"$/g, '').trim();

async function main() {
  const AT = await mintToken();
  const H = { Authorization: 'Bearer ' + AT };

  // List the install "overview" reports for this package.
  const prefix = `stats/installs/installs_${PKG}_`;
  const listUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(prefix)}`;
  const lr = await fetch(listUrl, { headers: H });
  if (!lr.ok) {
    const body = (await lr.text()).slice(0, 500);
    console.error('LIST failed — HTTP', lr.status, '\n', body);
    if (lr.status === 403) {
      console.error(
        '\n403 = the service account can reach Cloud Storage but not THIS bucket.\n' +
          'Grant it read on the reports bucket (Storage Object Viewer on gs://' + bucket + ').'
      );
    }
    process.exit(1);
  }
  const listing = await lr.json();
  const items = (listing.items || []).filter((o) => o.name.endsWith('_overview.csv'));
  if (!items.length) {
    console.error('No install overview reports under', prefix, '— stats may not exist yet, or wrong bucket/package.');
    process.exit(1);
  }
  items.sort((a, b) => a.name.localeCompare(b.name)); // filenames end in _YYYYMM_overview.csv → chronological
  const latest = items[items.length - 1];

  // Download + decode (UTF-16LE with BOM).
  const dl = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(latest.name)}?alt=media`,
    { headers: H }
  );
  if (!dl.ok) {
    console.error('DOWNLOAD failed — HTTP', dl.status, (await dl.text()).slice(0, 300));
    process.exit(1);
  }
  let text = Buffer.from(await dl.arrayBuffer()).toString('utf16le');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = text.split(/\r?\n/).filter((r) => r.trim());
  const header = rows[0].split(',').map(unq);
  const data = rows.slice(1).map((r) => r.split(','));
  const last = data[data.length - 1];

  // v1: show the real columns + the latest day so we can lock the summary to the
  // actual report shape, then tighten. (Play's column names shift over time.)
  console.log('report:   ', latest.name);
  console.log('span:     ', unq(data[0]?.[0]), '->', unq(last?.[0]), `(${data.length} days)`);
  console.log('\ncolumns:\n  ' + header.join('\n  '));
  console.log('\nlatest day (' + unq(last?.[0]) + '):');
  header.forEach((h, i) => console.log('  ' + h + ' = ' + unq(last?.[i])));

  // Best-effort friendly summary against common column names.
  const idx = (re) => header.findIndex((h) => re.test(h));
  const pick = (re) => {
    const i = idx(re);
    return i >= 0 ? unq(last?.[i]) : null;
  };
  const totalInstalls = pick(/total user installs/i);
  const activeDevices = pick(/active device installs/i) || pick(/current device installs/i);
  const dailyInstalls = pick(/daily (user|device) installs/i);
  console.log('\n— summary —');
  console.log('  total user installs:  ', totalInstalls ?? '(column not found — see above)');
  console.log('  active devices:       ', activeDevices ?? '(column not found — see above)');
  console.log('  installs that day:    ', dailyInstalls ?? '(column not found — see above)');
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
