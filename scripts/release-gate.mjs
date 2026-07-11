// Auto-arm the update prompt the moment a new App Store build goes LIVE. Checks the
// target iOS version's appStoreState via the ASC API; when it's READY_FOR_SALE
// (actually downloadable), it flips app_config.version.ios.latest so users on older
// versions get the "Update available" prompt. Idempotent + safe to run on a schedule —
// it does nothing until the version is live, and nothing once it's already flipped.
//
//   node release-gate.mjs                 # check iOS APP_VERSION, flip if live
//   node release-gate.mjs --version 1.0.4
//   node release-gate.mjs --dry-run       # report state, change nothing
//   node release-gate.mjs --platform android   # (only once it's on Play PRODUCTION)
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { APP_VERSION } from '../src/version.js';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const KEY_ID = g('ASC_API_KEY_ID'), ISSUER = g('ASC_API_ISSUER_ID'), APP_ID = g('ASC_APP_ID');
const p8 = readFileSync(new URL('../' + g('ASC_API_KEY_PATH'), import.meta.url), 'utf8');
const SB = g('SUPABASE_ACCESS_TOKEN');

const val = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const VERSION = val('--version') || APP_VERSION;
const PLATFORM = (val('--platform') || 'ios').toLowerCase();
const DRY = process.argv.includes('--dry-run');
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const si = `${b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })}.${b64({ iss: ISSUER, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
  return `${si}.${createSign('SHA256').update(si).end().sign({ key: p8, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
const asc = async (path) => {
  const r = await fetch('https://api.appstoreconnect.apple.com' + path, { headers: { Authorization: 'Bearer ' + jwt() } });
  const t = await r.text(); return { status: r.status, json: t ? JSON.parse(t) : null };
};
const sql = async (q) => {
  const r = await fetch('https://api.supabase.com/v1/projects/wtaefyspddadcrnovumk/database/query', {
    method: 'POST', headers: { Authorization: 'Bearer ' + SB, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }),
  });
  const t = await r.text(); try { return JSON.parse(t); } catch { return t; }
};

// Only iOS liveness is checked via the ASC API. Android has no equivalent public API,
// so `--platform android` just flips the gate (run it yourself once 1.0.4 is on Play
// production — internal-track builds are NOT publicly downloadable).
if (PLATFORM === 'ios') {
  const vr = await asc(`/v1/apps/${APP_ID}/appStoreVersions?filter[versionString]=${VERSION}&filter[platform]=IOS&limit=1`);
  const v = vr.json?.data?.[0];
  if (!v) { console.log(`[${stamp}] iOS ${VERSION}: no version record yet — not live. No change.`); process.exit(0); }
  const state = v.attributes.appStoreState;
  if (state !== 'READY_FOR_SALE') {
    console.log(`[${stamp}] iOS ${VERSION}: appStoreState=${state} — not live yet (need READY_FOR_SALE). No change.`);
    process.exit(0);
  }
  console.log(`[${stamp}] iOS ${VERSION} is LIVE (READY_FOR_SALE).`);
}

const cur = (await sql(`select value->'${PLATFORM}'->>'latest' as latest from public.app_config where key='version';`))[0]?.latest;
if (cur === VERSION) { console.log(`[${stamp}] ${PLATFORM}.latest already ${VERSION} — prompt already armed. Done.`); process.exit(0); }
if (DRY) { console.log(`[${stamp}] [dry] would flip ${PLATFORM}.latest ${cur} -> ${VERSION}.`); process.exit(0); }
const res = await sql(`update public.app_config set value=jsonb_set(value,'{${PLATFORM},latest}','"${VERSION}"'), updated_at=now() where key='version';`);
console.log(Array.isArray(res)
  ? `[${stamp}] ✔ Flipped ${PLATFORM}.latest ${cur} -> ${VERSION}. Users below ${VERSION} now get the "Update available" prompt.`
  : `[${stamp}] flip FAILED: ${JSON.stringify(res).slice(0, 200)}`);
