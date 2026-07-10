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
const FULL = process.argv.includes('--full');
console.log('\n--- description' + (FULL ? '' : ' (first 400)') + ' ---\n', FULL ? (en.attributes.description || '') : (en.attributes.description || '').slice(0, 400));
console.log('\n--- whatsNew ---\n', en.attributes.whatsNew || '(none)');
console.log('\nlocalization id:', en.id, '| version:', editable.attributes.versionString, '| state:', editable.attributes.appStoreState);

// Update promotional text only (takes effect without a review submission).
if (process.argv.includes('--set-promo')) {
  const PROMO = 'Now covering 120 Ohio towns across all five regions. Find local events, garage sales, and food trucks near you, updated every morning. Free.';
  const res = await api(`/v1/appStoreVersionLocalizations/${en.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ data: { type: 'appStoreVersionLocalizations', id: en.id, attributes: { promotionalText: PROMO } } }),
  });
  console.log('\nset-promo:', res.status, res.status < 300 ? 'OK' : JSON.stringify(res.json).slice(0, 300));
}

// The corrected listing copy — faithful to the live description, with the stale
// facts fixed (24 -> 79 towns, + Northeast Ohio and its metros, + the map view).
const DESCRIPTION = `Everything happening around Ohio, in one free app.

Local Loop brings together local events, garage sales, and food trucks across 120 towns in all five regions of Ohio, from Toledo and Findlay to Akron, Canton, Youngstown, Athens, and Springfield, all in one place, grouped by Today, This Week, and beyond.

Open it to answer one question: what's going on around here? Browse what's on today, this weekend, or later. Save the ones you like, get directions, and add them to your calendar in a tap.

What you'll find:
- Local events: concerts, festivals, markets, library programs, fundraisers, and more
- Garage sales: find the good ones near you, with maps and dates
- Food trucks: see who's parked where and when
- Map view: see what's on around you, then zoom out to catch the towns nearby

Built by a local, for locals. Post your own event or garage sale free in seconds, no account needed to browse.

Towns include Findlay, Toledo, Lima, Akron, Canton, Youngstown, Athens, Springfield, Mansfield, Marion, and 100 more across Northwest, Central, Northeast, Southeast, and Southwest Ohio.`;

const WHATS_NEW = `Local Loop now covers 120 towns across all five regions of Ohio, from Toledo and Findlay to Athens and Springfield. Plus a new map view: see what's on around you, then zoom out to catch nearby towns.`;

// Pre-stage the corrected description on the NEXT version so it ships with the
// next binary. A live (READY_FOR_SALE) version's description can't be edited in
// place, so this creates the version in "Prepare for Submission" and sets it.
//   node asc-listing.mjs --stage-next=1.0.3
const stageArg = (process.argv.find((a) => a.startsWith('--stage-next=')) || '').split('=')[1];
if (stageArg) {
  // Reuse an existing editable version of this number, else create it.
  let ver = versions.json.data.find((v) => v.attributes.versionString === stageArg);
  if (ver && ver.attributes.appStoreState === 'READY_FOR_SALE') {
    console.log(`\nversion ${stageArg} is already live — cannot edit; pick a higher number.`);
    process.exit(1);
  }
  if (!ver) {
    const created = await api('/v1/appStoreVersions', {
      method: 'POST',
      body: JSON.stringify({ data: {
        type: 'appStoreVersions',
        attributes: { platform: 'IOS', versionString: stageArg },
        relationships: { app: { data: { type: 'apps', id: APP_ID } } },
      } }),
    });
    if (created.status >= 300) { console.error('create version failed:', created.status, JSON.stringify(created.json).slice(0, 300)); process.exit(1); }
    ver = created.json.data;
    console.log(`\ncreated version ${stageArg} (${ver.attributes.appStoreState})`);
  } else {
    console.log(`\nreusing editable version ${stageArg} (${ver.attributes.appStoreState})`);
  }
  // Its en-US localization (auto-copied from the prior version) — PATCH it.
  const vlocs = await api(`/v1/appStoreVersions/${ver.id}/appStoreVersionLocalizations`);
  const ven = vlocs.json.data.find((l) => l.attributes.locale === 'en-US') || vlocs.json.data.find((l) => l.attributes.locale.startsWith('en'));
  if (!ven) { console.error('no en localization on new version'); process.exit(1); }
  const patch = await api(`/v1/appStoreVersionLocalizations/${ven.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ data: { type: 'appStoreVersionLocalizations', id: ven.id, attributes: { description: DESCRIPTION, whatsNew: WHATS_NEW } } }),
  });
  console.log('set description + whatsNew on', stageArg + ':', patch.status, patch.status < 300 ? 'OK' : JSON.stringify(patch.json).slice(0, 300));
  console.log('\nStaged. When the next binary uploads as ' + stageArg + ', it attaches to this version with the corrected description.');
}
