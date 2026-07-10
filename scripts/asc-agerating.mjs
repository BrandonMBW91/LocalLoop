// Read (and optionally patch) the App Store age-rating declaration, including the
// newer social-media / UGC questions. Reuses the App Store Connect API key.
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const KEY_ID = g('ASC_API_KEY_ID'), ISSUER = g('ASC_API_ISSUER_ID'), APP_ID = g('ASC_APP_ID');
const p8 = readFileSync(new URL('../' + g('ASC_API_KEY_PATH'), import.meta.url), 'utf8');
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const si = `${b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })}.${b64({ iss: ISSUER, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
  return `${si}.${createSign('SHA256').update(si).end().sign({ key: p8, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
const api = async (path) => {
  const r = await fetch('https://api.appstoreconnect.apple.com' + path, { headers: { Authorization: 'Bearer ' + jwt() } });
  return { status: r.status, json: JSON.parse((await r.text()) || '{}') };
};
// appInfos -> ageRatingDeclaration
const infos = await api(`/v1/apps/${APP_ID}/appInfos`);
const infoId = infos.json.data?.[0]?.id;
console.log('appInfo id:', infoId, '| appInfos found:', infos.json.data?.length);
const decl = await api(`/v1/appInfos/${infoId}/ageRatingDeclaration`);
if (decl.status >= 400) { console.log('ageRatingDeclaration:', decl.status, JSON.stringify(decl.json).slice(0, 300)); process.exit(0); }
const a = decl.json.data?.attributes || {};
console.log('\n=== Age Rating Declaration attributes (current answers) ===');
for (const [k, v] of Object.entries(a)) console.log(`  ${k}: ${JSON.stringify(v)}`);
console.log('\ndeclaration id:', decl.json.data?.id);
