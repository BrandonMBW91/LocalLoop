// Local Loop — Facebook ad test/control tracker.
//
// Measures the paired baseline test (see memory: ad-baseline-test): 3 TEST towns
// each running a $5/day Traffic ad + free community post, vs 3 matched CONTROL
// towns that get the free post only. The metric is per-town 30-day MAU — distinct
// devices seen in device_activity in the last 30 days, the SAME number the in-app
// Metrics screen shows. Net ad lift = test MAU gain minus control MAU gain, which
// cancels ordinary organic growth. Cost per acquired user = ad spend / net lift,
// judged against the decision rule below.
//
//   Decision rule (at day 7+):  < $3/user = SCALE ·  $3-5 = one more round
//                               > $5/user or net lift <= 0 = free posting wins
//
// Runs daily via the ll-ad-test scheduled task:
//   node ad-test-tracker.mjs --email   send the report to the owner + update state
//   node ad-test-tracker.mjs           print + update state, no email
//   node ad-test-tracker.mjs --dry     print only; does NOT touch state or email
//   node ad-test-tracker.mjs --reset   delete the saved baseline and exit; the
//                                      NEXT run captures a fresh baseline
//
// The baseline is captured automatically on the FIRST run (do that the morning the
// ads launch, before they can have any effect). Everything after is measured
// against it. Verdict is provisional until day 7, then firm; the routine keeps
// reporting through day 9 to catch installs that open the app a day or two late.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CITIES } from './src/data/cities.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const read = (p) => { try { return readFileSync(join(DIR, p), 'utf8'); } catch { return ''; } };
const env = read('.env') + '\n' + read('aggregator/.env');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const SB = g('EXPO_PUBLIC_SUPABASE_URL');
const KEY = g('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

const EMAIL = process.argv.includes('--email');
const DRY = process.argv.includes('--dry');

// --reset deletes the state and EXITS (it does not re-baseline in the same run:
// an evening reset would otherwise stamp startDate a day early and skew the
// day/spend math). The next run captures the fresh baseline.
if (process.argv.includes('--reset')) {
  try { unlinkSync(new URL(`./ad-test-state.json`, import.meta.url)); console.log('ad-test-state.json cleared; the next run captures a fresh baseline.'); }
  catch (e) {
    // Only a MISSING file is fine; a locked/permission-blocked file must fail
    // loudly, or the operator believes the test was reset while the old
    // baseline is still on disk.
    if (e.code === 'ENOENT') { console.log('no ad-test-state.json to clear.'); }
    else { console.error(`could not clear ad-test-state.json (${e.code}): ${e.message}`); process.exit(1); }
  }
  process.exit(0);
}

// --- Test design -------------------------------------------------------------
const PAIRS = [
  { size: 'Large', test: 'canton', control: 'youngstown' },
  { size: 'Mid', test: 'sandusky', control: 'ashland' },
  // Swapped off tiffin/bucyrus 2026-07-16 BEFORE any baseline: Tiffin had only 9
  // events in the next 7 days against Bucyrus's 14, so the test town was thinner
  // than its own control and could have lost for reasons nothing to do with ads
  // (and 9 events is a thin thing to pay to send people to). New Philadelphia
  // slots into the same small-town population band (17,677 vs Tiffin's 17,568)
  // and pairs with Fremont at ratio 1.11 - the tightest pair in the test - with
  // 56 events each in the next 7 days and 0 MAU on both sides.
  { size: 'Small', test: 'new-philadelphia', control: 'fremont' },
];
const TEST = PAIRS.map((p) => p.test);
const CONTROL = PAIRS.map((p) => p.control);
const ALL = [...TEST, ...CONTROL];
const DAILY_BUDGET = 5; // $/day per test town
const RUN_DAYS = 7;     // ad flight length
const SETTLE_DAYS = 2;  // keep reporting this many days past the flight for late opens
const STATE_FILE = 'ad-test-state.json';

const nameById = Object.fromEntries(CITIES.map((c) => [c.id, c.name]));
const nm = (id) => nameById[id] || id;

// --- Pull current 30-day MAU per town ----------------------------------------
const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
async function rows(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
// Paginate: PostgREST caps every response at the server max-rows (~1000)
// regardless of the requested limit, so a single request would silently
// undercount MAU exactly when the test succeeds and the towns grow.
const da = [];
for (let from = 0; ; from += 1000) {
  const page = await rows(`device_activity?select=city_id,last_seen&city_id=in.(${ALL.join(',')})&last_seen=gte.${since30}&order=device_id.asc&limit=1000&offset=${from}`);
  da.push(...page);
  if (page.length < 1000) break;
}
const mau = Object.fromEntries(ALL.map((id) => [id, 0]));
for (const r of da) if (mau[r.city_id] != null) mau[r.city_id] += 1;

// --- Load / init state -------------------------------------------------------
const todayKey = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
// A corrupt state file must ABORT, not silently re-baseline: re-baselining
// mid-flight against ad-inflated MAU would destroy the whole measurement.
let state = {};
if (existsSync(join(DIR, STATE_FILE))) {
  try { state = JSON.parse(read(STATE_FILE)); }
  catch (e) {
    console.error(`ad-test-state.json is corrupt (${e.message}). NOT re-baselining. Inspect the file, or run --reset to start the test over.`);
    process.exit(1);
  }
}
let firstRun = false;
if (!state.startDate) {
  firstRun = true;
  state = { startDate: todayKey, baseline: { ...mau }, history: [] };
}

const dayOf = (key) => Math.round((new Date(key + 'T00:00:00').getTime() - new Date(state.startDate + 'T00:00:00').getTime()) / 86400000);
const day = dayOf(todayKey); // 0 on the baseline day

// --- Compute lift ------------------------------------------------------------
const gain = Object.fromEntries(ALL.map((id) => [id, (mau[id] || 0) - (state.baseline[id] || 0)]));
const testGain = TEST.reduce((s, id) => s + gain[id], 0);
const controlGain = CONTROL.reduce((s, id) => s + gain[id], 0);
const netLift = testGain - controlGain;
const spend = DAILY_BUDGET * TEST.length * Math.min(Math.max(day, 0), RUN_DAYS);
const costPerUser = netLift > 0 ? spend / netLift : null;
const done = day > RUN_DAYS + SETTLE_DAYS;

function verdict() {
  if (day < RUN_DAYS) return { label: 'In progress', detail: `Day ${day} of ${RUN_DAYS}, provisional.` };
  if (netLift <= 0) return { label: 'Free posting wins', detail: 'Ads did not beat the free-post control. Do not scale paid.' };
  if (costPerUser < 3) return { label: 'SCALE paid acquisition', detail: `about $${costPerUser.toFixed(2)} per user, under the $3 bar.` };
  if (costPerUser <= 5) return { label: 'One more round', detail: `about $${costPerUser.toFixed(2)} per user, in the $3 to $5 grey zone.` };
  return { label: 'Free posting wins', detail: `about $${costPerUser.toFixed(2)} per user, over the $5 ceiling.` };
}
const v = verdict();
const sign = (n) => (n >= 0 ? '+' + n : String(n));

// --- Console report ----------------------------------------------------------
const REPORT = [];
const log = (s = '') => REPORT.push(s);
log(`\n===============  LOCAL LOOP - FACEBOOK AD TEST  ===============`);
if (firstRun) log(`  BASELINE captured for ${todayKey}. Ads should start today.`);
log(`  Started ${state.startDate}  |  Day ${day} of ${RUN_DAYS}  |  Spend so far $${spend}`);
log(`  Metric: per-town 30-day MAU (distinct devices, last 30 days)\n`);
log(`  PAIR    TEST town            CONTROL town`);
for (const p of PAIRS) {
  const t = `${nm(p.test)} ${sign(gain[p.test])} (${mau[p.test]})`;
  const c = `${nm(p.control)} ${sign(gain[p.control])} (${mau[p.control]})`;
  log(`  ${p.size.padEnd(6)}  ${t.padEnd(20)} ${c}`);
}
log('');
log(`  Test towns gain:     ${sign(testGain)}`);
log(`  Control towns gain:  ${sign(controlGain)}`);
log(`  NET AD LIFT:         ${sign(netLift)}   (test minus control)`);
log(`  Cost per net user:   ${costPerUser != null ? '$' + costPerUser.toFixed(2) : 'n/a (no positive lift yet)'}`);
log(`  VERDICT: ${v.label} - ${v.detail}`);
log(`  STATUS: ${done ? 'COMPLETE (safe to disable ll-ad-test)' : `RUNNING (day ${day}/${RUN_DAYS})`}`);
log(`  Note: gains show +change (current MAU). Numbers read from device_activity,`);
log(`  the same source as the in-app Metrics screen. Late installs can lag 1-2 days.`);
log(`===============================================================\n`);
console.log(REPORT.join('\n'));

// --- HTML email --------------------------------------------------------------
function buildHtml() {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const chip = (n) => `<b style="color:${n > 0 ? '#256B29' : n < 0 ? '#B22234' : '#8a8a8a'};">${esc(sign(n))}</b>`;
  const rowsHtml = PAIRS.map((p) => `<tr>
      <td style="padding:7px 6px;font-size:13px;color:#8a8a8a;">${esc(p.size)}</td>
      <td style="padding:7px 6px;font-size:14px;color:#191919;">${esc(nm(p.test))} ${chip(gain[p.test])} <span style="color:#8a8a8a;">(${mau[p.test]})</span></td>
      <td style="padding:7px 6px;font-size:14px;color:#191919;">${esc(nm(p.control))} ${chip(gain[p.control])} <span style="color:#8a8a8a;">(${mau[p.control]})</span></td>
    </tr>`).join('');
  const vColor = v.label.startsWith('SCALE') ? '#256B29' : v.label.startsWith('One') ? '#9A6B00' : v.label.startsWith('Free') ? '#B22234' : '#15315B';
  return `<div style="background:#f4f2ee;padding:16px 10px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">`
    + `<tr><td style="background:#15315B;padding:20px 18px;"><div style="color:#c9d4e8;font-size:12px;letter-spacing:1.5px;font-weight:700;">LOCAL LOOP &middot; FACEBOOK AD TEST</div><div style="color:#fff;font-size:20px;font-weight:800;margin-top:3px;">Day ${day} of ${RUN_DAYS}</div><div style="color:#9db0cf;font-size:13px;margin-top:4px;">Started ${esc(state.startDate)} &middot; spend so far $${spend} &middot; metric: 30-day MAU</div></td></tr>`
    + (firstRun ? `<tr><td style="padding:12px 18px;background:#eef4ee;font-size:14px;color:#256B29;">Baseline captured. Launch the 3 ads and post the 6 free community posts today.</td></tr>` : '')
    + `<tr><td style="padding:12px 18px 4px;"><div style="font-size:11px;font-weight:700;letter-spacing:.8px;color:#15315B;margin-bottom:4px;">PER-TOWN LIFT &middot; +change (current)</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:11px;color:#8a8a8a;padding:0 6px;">PAIR</td><td style="font-size:11px;color:#8a8a8a;padding:0 6px;">TEST (ad)</td><td style="font-size:11px;color:#8a8a8a;padding:0 6px;">CONTROL</td></tr>${rowsHtml}</table></td></tr>`
    + `<tr><td style="padding:10px 18px;border-top:1px solid #efede8;font-size:15px;color:#333;line-height:1.9;">Test towns gain: <b>${esc(sign(testGain))}</b><br>Control towns gain: <b>${esc(sign(controlGain))}</b><br>Net ad lift: <b style="font-size:18px;color:${netLift > 0 ? '#256B29' : '#B22234'};">${esc(sign(netLift))}</b> <span style="color:#8a8a8a;font-size:13px;">(test minus control)</span><br>Cost per net user: <b>${costPerUser != null ? '$' + costPerUser.toFixed(2) : 'n/a'}</b></td></tr>`
    + `<tr><td style="padding:14px 18px;background:${vColor};"><div style="color:#fff;font-size:12px;letter-spacing:.8px;font-weight:700;opacity:.85;">VERDICT ${day < RUN_DAYS ? '(provisional)' : ''}</div><div style="color:#fff;font-size:18px;font-weight:800;margin-top:2px;">${esc(v.label)}</div><div style="color:#e8eef6;font-size:14px;margin-top:3px;">${esc(v.detail)}</div></td></tr>`
    + `<tr><td style="padding:12px 18px;background:#faf9f6;font-size:12px;color:#9a9a9a;line-height:1.6;">Read from device_activity, the same source as the in-app Metrics screen. Late installs can take a day or two to open the app, so the routine keeps reporting through day ${RUN_DAYS + SETTLE_DAYS}. Decision rule: under $3/user scale, $3-5 one more round, over $5 or no lift the free posting wins.</td></tr>`
    + `</table></div>`;
}

// --- Email (Resend) ----------------------------------------------------------
const shouldEmail = EMAIL && !DRY && day <= RUN_DAYS + SETTLE_DAYS;
if (shouldEmail) {
  try {
    const key = g('RESEND_API_KEY');
    if (!key) throw new Error('missing RESEND_API_KEY');
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Local Loop <noreply@findlayevents.com>',
        to: ['michabw91@gmail.com'],
        subject: `FB ad test: day ${day}/${RUN_DAYS} - net lift ${sign(netLift)} - ${v.label}`,
        text: REPORT.join('\n'),
        html: buildHtml(),
      }),
    });
    if (!r.ok) throw new Error('Resend ' + r.status + ': ' + (await r.text()).slice(0, 200));
    console.log('  [emailed to michabw91@gmail.com]');
  } catch (e) {
    console.error('  email failed:', e.message);
  }
} else if (EMAIL && !DRY && done) {
  console.log('  [test complete: no email sent; disable the ll-ad-test routine]');
}

// --- Persist state -----------------------------------------------------------
if (!DRY) {
  state.history = (state.history || []).filter((h) => h.day !== day);
  state.history.push({ day, date: todayKey, mau: { ...mau }, testGain, controlGain, netLift, spend, costPerUser });
  writeFileSync(join(DIR, STATE_FILE), JSON.stringify(state, null, 2));
}
