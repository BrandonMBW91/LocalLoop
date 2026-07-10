// Read (and with --upload, replace) the App Store screenshots for the editable
// 1.0.3 version. Uploads the 1320x2868 (6.9") PNGs from a folder via the ASC
// reserve -> PUT bytes -> commit(md5) flow.
//   node asc-screenshots.mjs                 # show current sets
//   node asc-screenshots.mjs --upload=DIR    # replace the iPhone 6.9 set with DIR/*.png (sorted)
import { readFileSync, readdirSync } from 'node:fs';
import { createSign, createHash } from 'node:crypto';
import { join } from 'node:path';
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const KEY_ID = g('ASC_API_KEY_ID'), ISSUER = g('ASC_API_ISSUER_ID'), APP_ID = g('ASC_APP_ID');
const p8 = readFileSync(new URL('../' + g('ASC_API_KEY_PATH'), import.meta.url), 'utf8');
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const si = `${b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })}.${b64({ iss: ISSUER, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' })}`;
  return `${si}.${createSign('SHA256').update(si).end().sign({ key: p8, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
const api = async (path, opts = {}) => {
  const r = await fetch('https://api.appstoreconnect.apple.com' + path, {
    ...opts, headers: { Authorization: 'Bearer ' + jwt(), 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : null };
};

const versions = await api(`/v1/apps/${APP_ID}/appStoreVersions?limit=5`);
if (versions.status >= 400) { console.error('appStoreVersions:', versions.status, JSON.stringify(versions.json).slice(0, 200)); process.exit(1); }
const ver = versions.json.data.find((v) => ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED'].includes(v.attributes.appStoreState)) || versions.json.data[0];
console.log('version:', ver.attributes.versionString, '(' + ver.attributes.appStoreState + ')');
const locs = await api(`/v1/appStoreVersions/${ver.id}/appStoreVersionLocalizations`);
const en = locs.json.data.find((l) => l.attributes.locale === 'en-US') || locs.json.data[0];

const sets = await api(`/v1/appStoreVersionLocalizations/${en.id}/appScreenshotSets`);
console.log('\nscreenshot sets:');
for (const s of sets.json.data || []) {
  const shots = await api(`/v1/appScreenshotSets/${s.id}/appScreenshots`);
  console.log(`  ${s.attributes.screenshotDisplayType}: ${shots.json.data?.length || 0} screenshots`);
}

const uploadDir = (process.argv.find((a) => a.startsWith('--upload=')) || '').split('=')[1];
if (!uploadDir) process.exit(0);

// ---- upload flow ----
const DISPLAY = 'APP_IPHONE_67'; // 6.7"/6.9" large-iPhone set (accepts 1320x2868)
let set = (sets.json.data || []).find((s) => s.attributes.screenshotDisplayType === DISPLAY);
if (!set) {
  const created = await api('/v1/appScreenshotSets', { method: 'POST', body: JSON.stringify({ data: {
    type: 'appScreenshotSets', attributes: { screenshotDisplayType: DISPLAY },
    relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: en.id } } },
  } }) });
  set = created.json.data;
  console.log('created', DISPLAY, 'set');
}
// clear existing so we don't stack duplicates
const cur = await api(`/v1/appScreenshotSets/${set.id}/appScreenshots`);
for (const sc of cur.json.data || []) await api(`/v1/appScreenshots/${sc.id}`, { method: 'DELETE' });

const files = readdirSync(uploadDir).filter((f) => /\.png$/i.test(f)).sort();
console.log('\nuploading', files.length, 'screenshots from', uploadDir);
for (const f of files) {
  const bytes = readFileSync(join(uploadDir, f));
  // 1) reserve
  const res = await api('/v1/appScreenshots', { method: 'POST', body: JSON.stringify({ data: {
    type: 'appScreenshots', attributes: { fileName: f, fileSize: bytes.length },
    relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } },
  } }) });
  if (res.status >= 300) { console.log('  ! reserve failed', f, res.status, JSON.stringify(res.json).slice(0, 160)); continue; }
  const sc = res.json.data;
  // 2) PUT bytes to each upload operation
  for (const op of sc.attributes.uploadOperations) {
    const headers = Object.fromEntries((op.requestHeaders || []).map((h) => [h.name, h.value]));
    await fetch(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) });
  }
  // 3) commit with md5
  const md5 = createHash('md5').update(bytes).digest('hex');
  const done = await api(`/v1/appScreenshots/${sc.id}`, { method: 'PATCH', body: JSON.stringify({ data: {
    type: 'appScreenshots', id: sc.id, attributes: { uploaded: true, sourceFileChecksum: md5 },
  } }) });
  console.log('  ' + (done.status < 300 ? 'ok ' : 'FAIL ' + done.status + ' ') + f);
}
console.log('\nDone. Check App Store Connect -> 1.0.3 -> Screenshots to confirm/reorder.');
