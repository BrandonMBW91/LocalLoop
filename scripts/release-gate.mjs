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
import { APP_VERSION, WHATS_NEW } from '../src/version.js';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const KEY_ID = g('ASC_API_KEY_ID'), ISSUER = g('ASC_API_ISSUER_ID'), APP_ID = g('ASC_APP_ID');
const p8 = readFileSync(new URL('../' + g('ASC_API_KEY_PATH'), import.meta.url), 'utf8');
const SB = g('SUPABASE_ACCESS_TOKEN');

const val = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const VERSION = val('--version') || APP_VERSION;
const PLATFORM = (val('--platform') || 'ios').toLowerCase();
// Both values are interpolated into SQL and gate which store is checked, so
// validate hard: a typo'd platform would skip the ASC liveness check entirely
// and "flip" a key that doesn't exist.
if (!['ios', 'android'].includes(PLATFORM)) { console.error(`bad --platform "${PLATFORM}" (must be ios or android)`); process.exit(1); }
if (!/^\d+(\.\d+)*$/.test(VERSION)) { console.error(`bad --version "${VERSION}"`); process.exit(1); }
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
  // An ASC error (expired key, 401/403/429/5xx) must FAIL loudly, not read as
  // "no version record yet": that would silently report not-live forever.
  if (vr.status !== 200 || vr.json?.errors) {
    console.error(`[${stamp}] ASC API error (HTTP ${vr.status}): ${JSON.stringify(vr.json?.errors || vr.json).slice(0, 300)}`);
    process.exit(1);
  }
  const v = vr.json?.data?.[0];
  if (!v) { console.log(`[${stamp}] iOS ${VERSION}: no version record yet — not live. No change.`); process.exit(0); }
  const state = v.attributes.appStoreState;
  if (state !== 'READY_FOR_SALE') {
    console.log(`[${stamp}] iOS ${VERSION}: appStoreState=${state} — not live yet (need READY_FOR_SALE). No change.`);
    process.exit(0);
  }
  console.log(`[${stamp}] iOS ${VERSION} is LIVE (READY_FOR_SALE).`);
}

// The cur===VERSION check below is the ONLY thing standing between a scheduled
// re-run and a duplicate broadcast to every device, so a failed SELECT must
// abort — treating an error body as "not flipped yet" would re-push on every
// transient API blip.
const sel = await sql(`select value->'${PLATFORM}'->>'latest' as latest from public.app_config where key='version';`);
if (!Array.isArray(sel)) { console.error(`[${stamp}] gate SELECT failed (refusing to flip blind): ${JSON.stringify(sel).slice(0, 200)}`); process.exit(1); }
const cur = sel[0]?.latest;
if (cur === VERSION) { console.log(`[${stamp}] ${PLATFORM}.latest already ${VERSION} — prompt already armed. Done.`); process.exit(0); }
if (DRY) { console.log(`[${stamp}] [dry] would flip ${PLATFORM}.latest ${cur} -> ${VERSION}.`); process.exit(0); }
// RETURNING proves the row existed AND the value actually changed; jsonb_set
// silently no-ops when the platform key is absent, and the management API
// returns [] for an UPDATE that matched zero rows — both would otherwise
// "succeed" and broadcast without ever arming the prompt.
const res = await sql(`update public.app_config set value=jsonb_set(value,'{${PLATFORM},latest}','"${VERSION}"'), updated_at=now() where key='version' returning value->'${PLATFORM}'->>'latest' as latest;`);
if (!Array.isArray(res) || res.length !== 1 || res[0]?.latest !== VERSION) {
  console.error(`[${stamp}] flip FAILED or unverified (no broadcast sent): ${JSON.stringify(res).slice(0, 200)}`);
  process.exit(1);
}
console.log(`[${stamp}] ✔ Flipped ${PLATFORM}.latest ${cur} -> ${VERSION}. Users below ${VERSION} now get the in-app "Update available" prompt.`);

// One-time broadcast push so users are told to update even without opening the app.
// Runs ONLY on the flip (the check above is idempotent), and ONLY to this platform's
// tokens — the other store may not have the release yet. Best-effort.
const store = PLATFORM === 'android' ? 'Play Store' : 'App Store';
const rows = await sql(`select token from public.push_tokens where platform='${PLATFORM}' and token is not null;`);
const tokens = Array.isArray(rows) ? rows.map((r) => r.token) : [];
const body = `${WHATS_NEW} Update now in the ${store}.`;
let sent = 0;
for (let i = 0; i < tokens.length; i += 100) {
  const batch = tokens.slice(i, i + 100).map((to) => ({ to, title: 'Update available', body, sound: 'default' }));
  try {
    const pr = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(batch) });
    if (pr.ok) sent += batch.length;
  } catch { /* best-effort broadcast */ }
}
console.log(`[${stamp}] update push sent to ${sent}/${tokens.length} ${PLATFORM} device(s).`);
