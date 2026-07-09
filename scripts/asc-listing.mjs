// Read (and optionally update) App Store Connect listing metadata for Local Loop.
//   node asc-listing.mjs               # read current promo text + description + state
//   node asc-listing.mjs --set-promo   # update promotional_text (NO review needed)
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
// App Store Connect API key (metadata/App Manager role) — distinct from the
// Sales & Reports key (ASC_KEY_ID) used by the install-stats puller.
const KEY_ID = g('ASC_API_KEY_ID'), ISSUER = g('ASC_API_ISSUER_ID'), APP_ID = g('ASC_APP_ID');
const p8 = readFileSync(new URL('../' + g('ASC_API_KEY_PATH'), import.meta.url), 'utf8');

// ASC JWT: ES256, raw (P1363) signature, aud appstoreconnect-v1, <=20min exp.
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const payload = { iss: ISSUER, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const sig = createSign('SHA256').update(signingInput).end()
    .sign({ key: p8, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${sig.toString('base64url')}`;
}
const api = async (path, opts = {}) => {
  const r = await fetch('https://api.appstoreconnect.apple.com' + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + jwt(), 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : null };
};

// Find the editable (or live) App Store version + its english localization.
const versions = await api(`/v1/apps/${APP_ID}/appStoreVersions?limit=5`);
if (versions.status >= 400) { console.error('versions:', versions.status, JSON.stringify(versions.json).slice(0, 300)); process.exit(1); }
for (const v of versions.json.data) {
  console.log(`version ${v.attributes.versionString} — state: ${v.attributes.appStoreState}`);
}
const editable = versions.json.data.find((v) =>
  ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'].includes(v.attributes.appStoreState))
  || versions.json.data[0];
console.log('\nusing version:', editable.attributes.versionString, `(${editable.attributes.appStoreState})`);

const locs = await api(`/v1/appStoreVersions/${editable.id}/appStoreVersionLocalizations`);
const en = locs.json.data.find((l) => l.attributes.locale.startsWith('en')) || locs.json.data[0];
console.log('locale:', en.attributes.locale);
console.log('\n--- promotionalText ---\n', en.attributes.promotionalText || '(empty)');
console.log('\n--- description (first 400) ---\n', (en.attributes.description || '').slice(0, 400));
console.log('\nlocalization id:', en.id, '| version state:', editable.attributes.appStoreState);

// Update promotional text only (takes effect without a review submission).
if (process.argv.includes('--set-promo')) {
  const PROMO = 'Now covering 79 Ohio towns across Northwest, Central, and Northeast Ohio. Find local events, garage sales, and food trucks near you, updated every morning. Free.';
  const res = await api(`/v1/appStoreVersionLocalizations/${en.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ data: { type: 'appStoreVersionLocalizations', id: en.id, attributes: { promotionalText: PROMO } } }),
  });
  console.log('\nset-promo:', res.status, res.status < 300 ? 'OK' : JSON.stringify(res.json).slice(0, 300));
}
