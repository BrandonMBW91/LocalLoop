// Local Loop — Facebook ad test/control tracker.
//
// WHAT THIS ACTUALLY MEASURES: **ad vs NOTHING.** 3 TEST towns run a $5/day Traffic
// ad; 3 matched CONTROL towns get nothing at all. NOBODY gets a community post —
// there is a no-post blackout on all six towns for the duration, enforced by
// fb-daily-plan.mjs.
//
// This header used to describe the ORIGINAL design (ad + free post vs free post
// only), which was abandoned before launch because group coverage runs backwards:
// New Philadelphia has zero Facebook groups and Sandusky's one group removed the
// post, while all three CONTROLS have live posted groups. The stale text was not
// harmless — the verdict below inherited it and would have declared "free posting
// wins" about an arm that never ran, off a live $105 experiment.
//
// Ad-vs-nothing is arguably the more useful question anyway: for any town we expand
// into cold, "what does $5/day buy from zero" is exactly the number needed, and for
// towns like New Philadelphia free posting is not even available.
//
// The metric is per-town 30-day MAU — distinct devices in human_activity over 30
// days, the SAME number the in-app Metrics screen shows. Net lift = test MAU gain
// minus control MAU gain, which cancels ordinary organic growth. With the controls
// at zero, net lift is essentially the test gain, and the controls' job is to prove
// there is no organic baseline to confuse it with. Cost per user = spend / net lift.
//
//   Decision rule (at day 7+), an ABSOLUTE cost bar — NOT a comparison against
//   free posting, which this test does not measure:
//     < $3/user = scale paid · $3-5 = one more round · > $5 or no lift = do not scale
//
// COUNTING: this reads human_activity, the view that hides devices marked as bots
// or as the owner's own (supabase/metrics_exclusions.sql). It no longer depends on
// the 7 AM purge having run first: filtering happens at READ time now, so a bot that
// appears at 9 AM cannot inflate a number the way it used to between cron runs.
// That inflation was real, not theoretical: on 2026-07-16 two automated agents had
// sandusky reporting 16 users against 8 real, making cost-per-user ~30% optimistic —
// which is exactly the number this experiment exists to measure.
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
// Accepts BOTH spellings on purpose. The repo had scripts taking --dry and others
// taking --dry-run, so typing the wrong one at the wrong script ran it FOR REAL with no
// warning. That happened on 2026-07-21: 'seatgeek.mjs --dry' was a live import.
// Widening the match can only ever make a run more dry, never less.
const DRY = process.argv.includes('--dry-run') || process.argv.includes('--dry');

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
  const page = await rows(`human_activity?select=city_id,platform,last_seen&city_id=in.(${ALL.join(',')})&last_seen=gte.${since30}&order=device_id.asc&limit=1000&offset=${from}`);
  da.push(...page);
  if (page.length < 1000) break;
}
// TWO numbers, because only one of them is a person you acquired.
//
// These campaigns optimise for LANDING PAGE VIEWS, and a web visitor lands in
// device_activity exactly like an app user — so blended "MAU" in an ad town is mostly
// the ad click itself, and the metric partly measures the spend paying for it.
// Measured 2026-07-21: the three ad towns were 97-99% web (Canton 172/176, Sandusky
// 144/146, New Philadelphia 205/208) against 9 installs total, while un-advertised
// Findlay was a real mix (63 iOS, 11 Android). The blended figure read "$0.16 per
// user" and passed the "$3 = scale" bar; the same spend was ~$9 per install, which
// fails the "$5 = do not scale" ceiling. Reporting one number would have bought a
// scale-up decision on cost-per-click wearing the label cost-per-user.
const mau = Object.fromEntries(ALL.map((id) => [id, 0]));      // everyone, web included
const mauApp = Object.fromEntries(ALL.map((id) => [id, 0]));   // installs only
for (const r of da) {
  if (mau[r.city_id] == null) continue;
  mau[r.city_id] += 1;
  if (r.platform === 'ios' || r.platform === 'android') mauApp[r.city_id] += 1;
}

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
  // baselineApp matters for the NEXT test: without it the install lift is measured
  // from zero rather than from where the town actually started.
  state = { startDate: todayKey, baseline: { ...mau }, baselineApp: { ...mauApp }, history: [] };
}

const dayOf = (key) => Math.round((new Date(key + 'T00:00:00').getTime() - new Date(state.startDate + 'T00:00:00').getTime()) / 86400000);
const day = dayOf(todayKey); // 0 on the baseline day

// --- Compute lift ------------------------------------------------------------
const gain = Object.fromEntries(ALL.map((id) => [id, (mau[id] || 0) - (state.baseline[id] || 0)]));
const testGain = TEST.reduce((s, id) => s + gain[id], 0);
const controlGain = CONTROL.reduce((s, id) => s + gain[id], 0);
const netLift = testGain - controlGain;
const spend = DAILY_BUDGET * TEST.length * Math.min(Math.max(day, 0), RUN_DAYS);
const costPerUser = netLift > 0 ? spend / netLift : null;   // per WEB VISIT, kept for history continuity

// App-only lift. baselineApp is absent on a test that started before this split
// existed; treating it as 0 is safe here because this test began with 0 MAU on both
// sides (the New Philadelphia swap above was made precisely to get 0/0), so the worst
// case is a handful of units.
const baseApp = state.baselineApp || {};
const gainApp = Object.fromEntries(ALL.map((id) => [id, (mauApp[id] || 0) - (baseApp[id] || 0)]));
const testGainApp = TEST.reduce((s, id) => s + gainApp[id], 0);
const controlGainApp = CONTROL.reduce((s, id) => s + gainApp[id], 0);
const netLiftApp = testGainApp - controlGainApp;
const costPerInstall = netLiftApp > 0 ? spend / netLiftApp : null;
const done = day > RUN_DAYS + SETTLE_DAYS;
const sign = (n) => (n >= 0 ? '+' + n : String(n));

// The labels are an ABSOLUTE cost-per-user bar. They must never claim anything about
// free posting: no town in this test got a post, so any "free posting wins" verdict
// would be a conclusion about an experiment that does not exist. That is what these
// said until 2026-07-16, inherited from the abandoned original design.
// Judged on INSTALLS, never on blended MAU. Grading these campaigns on the blended
// number grades them on their own clicks: they buy landing page views, and a landing
// page view IS a row in the table the verdict reads.
function verdict() {
  if (day < RUN_DAYS) return { label: 'In progress', detail: `Day ${day} of ${RUN_DAYS}, provisional.` };
  if (netLiftApp <= 0) {
    return netLift > 0
      ? { label: 'DO NOT scale paid', detail: `${sign(netLift)} web visits but no app installs. The ads bought traffic, not users.` }
      : { label: 'DO NOT scale paid', detail: 'No measurable lift over the untouched control towns.' };
  }
  if (costPerInstall < 3) return { label: 'SCALE paid acquisition', detail: `about $${costPerInstall.toFixed(2)} per install, under the $3 bar.` };
  if (costPerInstall <= 5) return { label: 'One more round', detail: `about $${costPerInstall.toFixed(2)} per install, in the $3 to $5 grey zone.` };
  return { label: 'DO NOT scale paid', detail: `about $${costPerInstall.toFixed(2)} per install, over the $5 ceiling.` };
}
const v = verdict();

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
log(`  NET LIFT, web visits: ${sign(netLift)}  ->  ${costPerUser != null ? '$' + costPerUser.toFixed(2) : 'n/a'} per visit`);
log(`  NET LIFT, INSTALLS:   ${sign(netLiftApp)}  ->  ${costPerInstall != null ? '$' + costPerInstall.toFixed(2) : 'n/a'} per install   <- the decision number`);
if (netLift > 0 && netLiftApp <= 0) {
  log('  NOTE: these ads bought website traffic, not app users. They optimise for landing');
  log('        page views, and a web visit counts here exactly like an install.');
}
log(`  VERDICT: ${v.label} - ${v.detail}`);
log(`  STATUS: ${done ? 'COMPLETE (safe to disable ll-ad-test)' : `RUNNING (day ${day}/${RUN_DAYS})`}`);
log(`  Note: gains show +change (current MAU). Numbers exclude bot and owner devices.`);
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
  // Keyed off the CURRENT labels. This said startsWith('Free') until 2026-07-16, so
  // renaming the verdict silently dropped the red banner to default navy — a "do not
  // scale" result would have arrived looking like neutral information.
  const vColor = v.label.startsWith('SCALE') ? '#256B29' : v.label.startsWith('One') ? '#9A6B00' : v.label.startsWith('DO NOT') ? '#B22234' : '#15315B';
  return `<div style="background:#f4f2ee;padding:16px 10px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">`
    + `<tr><td style="background:#15315B;padding:20px 18px;"><div style="color:#c9d4e8;font-size:12px;letter-spacing:1.5px;font-weight:700;">LOCAL LOOP &middot; FACEBOOK AD TEST</div><div style="color:#fff;font-size:20px;font-weight:800;margin-top:3px;">Day ${day} of ${RUN_DAYS}</div><div style="color:#9db0cf;font-size:13px;margin-top:4px;">Started ${esc(state.startDate)} &middot; spend so far $${spend} &middot; metric: 30-day MAU</div></td></tr>`
    + (firstRun ? `<tr><td style="padding:12px 18px;background:#eef4ee;font-size:14px;color:#256B29;">Baseline captured. Launch the 3 ads and post the 6 free community posts today.</td></tr>` : '')
    + `<tr><td style="padding:12px 18px 4px;"><div style="font-size:11px;font-weight:700;letter-spacing:.8px;color:#15315B;margin-bottom:4px;">PER-TOWN LIFT &middot; +change (current)</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:11px;color:#8a8a8a;padding:0 6px;">PAIR</td><td style="font-size:11px;color:#8a8a8a;padding:0 6px;">TEST (ad)</td><td style="font-size:11px;color:#8a8a8a;padding:0 6px;">CONTROL</td></tr>${rowsHtml}</table></td></tr>`
    + `<tr><td style="padding:10px 18px;border-top:1px solid #efede8;font-size:15px;color:#333;line-height:1.9;">Test towns gain: <b>${esc(sign(testGain))}</b><br>Control towns gain: <b>${esc(sign(controlGain))}</b><br>Net ad lift: <b style="font-size:18px;color:${netLift > 0 ? '#256B29' : '#B22234'};">${esc(sign(netLift))}</b> <span style="color:#8a8a8a;font-size:13px;">(test minus control)</span><br>Cost per net user: <b>${costPerUser != null ? '$' + costPerUser.toFixed(2) : 'n/a'}</b></td></tr>`
    + `<tr><td style="padding:14px 18px;background:${vColor};"><div style="color:#fff;font-size:12px;letter-spacing:.8px;font-weight:700;opacity:.85;">VERDICT ${day < RUN_DAYS ? '(provisional)' : ''}</div><div style="color:#fff;font-size:18px;font-weight:800;margin-top:2px;">${esc(v.label)}</div><div style="color:#e8eef6;font-size:14px;margin-top:3px;">${esc(v.detail)}</div></td></tr>`
    + `<tr><td style="padding:12px 18px;background:#faf9f6;font-size:12px;color:#9a9a9a;line-height:1.6;">Read from the same source as the in-app Metrics screen, with bot-minted and owner devices excluded. Late installs can take a day or two to open the app, so the routine keeps reporting through day ${RUN_DAYS + SETTLE_DAYS}. This measures ads against untouched control towns, not against free posting: no town in the test got a community post. Decision rule: under $3/user scale, $3-5 one more round, over $5 or no lift do not scale.</td></tr>`
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
        from: 'Local Loop <noreply@localloop.io>',
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
  state.history.push({ day, date: todayKey, mau: { ...mau }, mauApp: { ...mauApp }, testGain, controlGain, netLift, spend, costPerUser, netLiftApp, costPerInstall });
  writeFileSync(join(DIR, STATE_FILE), JSON.stringify(state, null, 2));
}
