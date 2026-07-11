// One-command App Store Connect "submit for review" via the ASC API. Reuses the ASC
// API-key auth from asc-listing.mjs. Finds (or creates) the target App Store version,
// sets the "What's New" notes, attaches the processed build, and submits it for review
// — the manual App Store Connect click-through, automated.
//
//   node asc-submit.mjs                       # version + notes default from src/version.js
//   node asc-submit.mjs --notes "..."         # custom release notes
//   node asc-submit.mjs --version 1.0.4 --build 12
//   node asc-submit.mjs --dry-run             # show the plan + build status, change nothing
//
// Requires the iOS build to be UPLOADED and finished processing (processingState VALID);
// run `eas submit -p ios` first, then this once Apple's "processing" email arrives.
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { APP_VERSION, WHATS_NEW } from '../src/version.js';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const KEY_ID = g('ASC_API_KEY_ID'), ISSUER = g('ASC_API_ISSUER_ID'), APP_ID = g('ASC_APP_ID');
const p8 = readFileSync(new URL('../' + g('ASC_API_KEY_PATH'), import.meta.url), 'utf8');

const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes('--dry-run');
const VERSION = val('--version') || APP_VERSION;
const NOTES = val('--notes') || WHATS_NEW;
const BUILD = val('--build');
const die = (m) => { console.error('✗ ' + m); process.exit(1); };

function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })}.${b64({ iss: ISSUER, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
  const sig = createSign('SHA256').update(signingInput).end().sign({ key: p8, dsaEncoding: 'ieee-p1363' });
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

console.log(`ASC submit — version ${VERSION}${BUILD ? ` build ${BUILD}` : ''}${DRY ? '  [DRY RUN]' : ''}`);
console.log(`notes: ${NOTES}\n`);

// 1) Find or create the App Store version (iOS).
const vr = await api(`/v1/apps/${APP_ID}/appStoreVersions?filter[versionString]=${VERSION}&filter[platform]=IOS&limit=1`);
if (vr.status >= 400) die(`list versions ${vr.status}: ${JSON.stringify(vr.json).slice(0, 300)}`);
let version = vr.json.data[0];
if (version) {
  console.log(`version ${VERSION}: exists — state ${version.attributes.appStoreState} (${version.id})`);
} else if (DRY) {
  console.log(`version ${VERSION}: not found — [dry] would create it`);
} else {
  const cr = await api('/v1/appStoreVersions', { method: 'POST', body: JSON.stringify({ data: { type: 'appStoreVersions', attributes: { platform: 'IOS', versionString: VERSION }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } } }) });
  if (cr.status >= 400) die(`create version ${cr.status}: ${JSON.stringify(cr.json).slice(0, 400)}`);
  version = cr.json.data;
  console.log(`version ${VERSION}: created (${version.id})`);
}

// 2) Set "What's New" on the en localization (find or create).
if (version) {
  const locs = await api(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
  const en = (locs.json?.data || []).find((l) => l.attributes.locale.startsWith('en'));
  if (DRY) {
    console.log(`whatsNew: [dry] would set on ${en ? en.attributes.locale : 'a new en-US'} localization`);
  } else if (en) {
    const pr = await api(`/v1/appStoreVersionLocalizations/${en.id}`, { method: 'PATCH', body: JSON.stringify({ data: { type: 'appStoreVersionLocalizations', id: en.id, attributes: { whatsNew: NOTES } } }) });
    if (pr.status >= 400) die(`set whatsNew ${pr.status}: ${JSON.stringify(pr.json).slice(0, 300)}`);
    console.log(`whatsNew: set on ${en.attributes.locale}`);
  } else {
    const cr = await api('/v1/appStoreVersionLocalizations', { method: 'POST', body: JSON.stringify({ data: { type: 'appStoreVersionLocalizations', attributes: { locale: 'en-US', whatsNew: NOTES }, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } } }) });
    if (cr.status >= 400) die(`create localization ${cr.status}: ${JSON.stringify(cr.json).slice(0, 300)}`);
    console.log('whatsNew: created en-US localization');
  }
}

// 3) Find the processed build + attach it.
const br = await api(`/v1/builds?filter[app]=${APP_ID}&filter[preReleaseVersion.version]=${VERSION}&sort=-uploadedDate&limit=25`);
if (br.status >= 400) die(`list builds ${br.status}: ${JSON.stringify(br.json).slice(0, 300)}`);
const builds = br.json.data || [];
const build = BUILD ? builds.find((b) => b.attributes.version === String(BUILD))
  : builds.find((b) => b.attributes.processingState === 'VALID') || builds[0];
if (!build) die(`no uploaded build found for ${VERSION}${BUILD ? ` build ${BUILD}` : ''} — run \`eas submit -p ios\` first, and wait for processing.`);
const ready = build.attributes.processingState === 'VALID';
console.log(`build ${build.attributes.version}: processingState ${build.attributes.processingState}${ready ? '' : '  (Apple still processing — re-run when VALID)'}`);
if (version && ready && !DRY) {
  const at = await api(`/v1/appStoreVersions/${version.id}/relationships/build`, { method: 'PATCH', body: JSON.stringify({ data: { type: 'builds', id: build.id } }) });
  if (at.status >= 400) die(`attach build ${at.status}: ${JSON.stringify(at.json).slice(0, 300)}`);
  console.log(`build ${build.attributes.version}: attached to ${VERSION}`);
}

if (DRY) { console.log('\n[dry run] nothing changed. Re-run without --dry-run when the build is VALID to set notes, attach, and submit.'); process.exit(0); }
if (!ready) die('build not finished processing yet (processingState != VALID). Try again shortly.');

// 4) Submit for review (reviewSubmissions flow: create/reuse -> add item -> submit).
const existing = await api(`/v1/apps/${APP_ID}/reviewSubmissions?filter[platform]=IOS&limit=20`);
let rs = (existing.json?.data || []).find((s) => s.attributes.submitted !== true
  && !['COMPLETE', 'IN_REVIEW', 'CANCELING'].includes(s.attributes.state));
if (rs) {
  console.log(`review submission: reusing open one (${rs.id}, ${rs.attributes.state})`);
} else {
  const cr = await api('/v1/reviewSubmissions', { method: 'POST', body: JSON.stringify({ data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } } }) });
  if (cr.status >= 400) die(`create reviewSubmission ${cr.status}: ${JSON.stringify(cr.json).slice(0, 400)}`);
  rs = cr.json.data;
  console.log(`review submission: created (${rs.id})`);
}
const item = await api('/v1/reviewSubmissionItems', { method: 'POST', body: JSON.stringify({ data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: rs.id } }, appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } } }) });
if (item.status >= 400 && !JSON.stringify(item.json || {}).toLowerCase().includes('already')) die(`add review item ${item.status}: ${JSON.stringify(item.json).slice(0, 400)}`);
console.log('review submission: version added');
const sub = await api(`/v1/reviewSubmissions/${rs.id}`, { method: 'PATCH', body: JSON.stringify({ data: { type: 'reviewSubmissions', id: rs.id, attributes: { submitted: true } } }) });
if (sub.status >= 400) die(`submit ${sub.status}: ${JSON.stringify(sub.json).slice(0, 400)}`);
console.log(`\n✔ Submitted ${VERSION} (build ${build.attributes.version}) for App Store review — state: ${sub.json?.data?.attributes?.state}`);
