// validate-routines.mjs - safe self-check for every active Local Loop routine.
//
// DRY / READ-ONLY ONLY. This never sends an email, never fires a push, never
// pushes git, and never touches the ad-test baseline. It exercises each routine's
// underlying script through its guaranteed-safe path (or, where a script has a
// live side effect that can't be neutered, only syntax + env), and pings the
// shared infra (Supabase, Resend). Use it to confirm no routine will error or
// stall on its next scheduled run.
//
//   node validate-routines.mjs          full check (dry runs + connectivity)
//   node validate-routines.mjs --quick  syntax + env + file presence only (no network)
//
// Deliberately NOT run live (would have real side effects): release-gate.mjs
// (flips the version gate + broadcast push once 1.0.4 is live), sync-memory.sh
// push (pushes git), send-email.mjs, and the non-dry send/spotlight paths.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const QUICK = process.argv.includes('--quick');
const read = (p) => { try { return readFileSync(join(DIR, p), 'utf8'); } catch { return ''; } };
const env = read('.env') + '\n' + read('aggregator/.env');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();

const results = []; // { routine, status: PASS|FAIL|WARN|SKIP, detail }
const add = (routine, status, detail) => results.push({ routine, status, detail });

// On Windows a bare "bash" can resolve to WSL's System32 bash.exe (which cannot
// read C:\ paths and false-FAILs every .sh check outside Git Bash). Prefer Git
// Bash explicitly when it exists.
const GIT_BASH = 'C:/Program Files/Git/usr/bin/bash.exe';
const BASH = process.platform === 'win32' && existsSync(GIT_BASH) ? GIT_BASH : 'bash';

// ---- primitive checks -------------------------------------------------------
function syntaxOk(relPath) {
  const abs = join(DIR, relPath);
  if (!existsSync(abs)) return { ok: false, why: `missing: ${relPath}` };
  const isSh = relPath.endsWith('.sh');
  const r = spawnSync(isSh ? BASH : process.execPath, isSh ? ['-n', abs] : ['--check', abs], {
    encoding: 'utf8', timeout: 30000,
  });
  return r.status === 0 ? { ok: true } : { ok: false, why: `syntax: ${relPath} (${(r.stderr || '').trim().split('\n')[0]})` };
}

function envPresent(keys) {
  const missing = keys.filter((k) => !g(k));
  return missing.length ? { ok: false, why: `env missing: ${missing.join(', ')}` } : { ok: true };
}

function fileExists(relPath, label) {
  return existsSync(join(DIR, relPath)) ? { ok: true } : { ok: false, why: `${label || 'missing'}: ${relPath}` };
}

// Run a guaranteed-safe command and confirm it exits 0 (and optionally that its
// output contains a marker proving it took the real path, not an early bail).
function runSafe(cmd, args, { cwd = DIR, expect = null, timeout = 90000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout });
  if (r.error) return { ok: false, why: `run error: ${r.error.message}` };
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) return { ok: false, why: `exit ${r.status}: ${(out.trim().split('\n').pop() || '').slice(0, 120)}` };
  if (expect && !out.includes(expect)) return { ok: false, why: `ran but output missing "${expect}"` };
  return { ok: true };
}

// ---- routine definitions ----------------------------------------------------
// dry() returns a check result and MUST have no side effects.
const ROUTINES = [
  {
    id: 'll-morning-brief',
    scripts: ['daily-report.mjs', 'aggregator/feed-health.mjs'],
    env: ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY'],
    // daily-report with NO --email is read-only; proves the metrics path works.
    dry: () => runSafe(process.execPath, ['daily-report.mjs'], { expect: 'DAILY REPORT', timeout: 120000 }),
  },
  {
    id: 'll-ad-test',
    scripts: ['ad-test-tracker.mjs'],
    env: ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY'],
    dry: () => runSafe(process.execPath, ['ad-test-tracker.mjs', '--dry'], { expect: 'FACEBOOK AD TEST' }),
  },
  {
    id: 'll-evening-spotlight',
    scripts: ['aggregator/spotlight-candidates.mjs'],
    env: ['CRON_SECRET', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'],
    // spotlight-candidates is read-only; the push function is checked via a dry POST below.
    dry: () => runSafe(process.execPath, ['spotlight-candidates.mjs'], { cwd: join(DIR, 'aggregator'), timeout: 60000 }),
  },
  {
    id: 'll-outreach-send',
    scripts: ['aggregator/send-queue.mjs', 'aggregator/send-email.mjs'],
    env: ['ZOHO_SMTP_USER', 'ZOHO_SMTP_PASS'],
    files: [['outreach', 'outreach queue dir']],
    // --dry-run exits before any send and guards every mailbox/state mutation.
    dry: () => runSafe(process.execPath, ['send-queue.mjs', '--dry-run', '--limit=1'], { cwd: join(DIR, 'aggregator'), expect: 'DRY', timeout: 120000 }),
  },
  {
    id: 'localloop-release-gate-104',
    scripts: ['scripts/release-gate.mjs'],
    files: [['.asc', 'App Store Connect key dir']],
    // --dry-run is a read-only ASC state check: it exits before any flip/push.
    dry: () => runSafe(process.execPath, ['scripts/release-gate.mjs', '--dry-run'], { timeout: 60000 }),
  },
  {
    id: 'll-memory-sync',
    scripts: ['scripts/sync-memory.sh'],
    // NOT run live (it pushes git). Real read-only probe instead: can this
    // machine reach the sync remote with its stored credentials? This is the
    // exact remote sync-memory.sh pushes to, so an auth break fails HERE
    // instead of silently failing every night at 9:40 PM.
    dry: () => {
      const r = spawnSync('git', ['ls-remote', 'https://github.com/BrandonMBW91/localloop-memory.git', 'HEAD'], { encoding: 'utf8', timeout: 30000 });
      if (r.error) return { ok: false, why: `git unavailable: ${r.error.message}` };
      return r.status === 0
        ? { ok: true }
        : { ok: false, why: `sync remote unreachable/auth failed: ${(r.stderr || '').trim().split('\n')[0]}` };
    },
  },
];

// ---- run per-routine checks -------------------------------------------------
for (const r of ROUTINES) {
  // 1. syntax
  let failed = false;
  for (const s of r.scripts || []) {
    const c = syntaxOk(s);
    if (!c.ok) { add(r.id, 'FAIL', c.why); failed = true; }
  }
  // 2. env
  if (r.env) {
    const c = envPresent(r.env);
    if (!c.ok) { add(r.id, 'FAIL', c.why); failed = true; }
  }
  // 3. referenced files
  for (const [f, label] of r.files || []) {
    const c = fileExists(f, label);
    if (!c.ok) { add(r.id, 'WARN', c.why); }
  }
  if (failed) continue;
  // 4. safe dry run (skipped in --quick or when the routine has no safe path)
  if (!QUICK && r.dry) {
    const c = r.dry();
    add(r.id, c.ok ? 'PASS' : 'FAIL', c.ok ? 'syntax + env + dry-run OK' : c.why);
  } else {
    add(r.id, r.dry ? 'WARN' : 'PASS', r.dry ? 'syntax + env OK (dry run skipped: --quick)' : 'syntax + env OK (no live run by design)');
  }
}

// ---- shared infra (read-only) ----------------------------------------------
if (!QUICK) {
  // Supabase reachability + service-role auth (a single count, read-only).
  try {
    const SB = g('EXPO_PUBLIC_SUPABASE_URL');
    const KEY = g('SUPABASE_SERVICE_ROLE_KEY');
    const res = await fetch(`${SB}/rest/v1/app_config?select=key&limit=1`, {
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY },
    });
    add('infra:supabase', res.ok ? 'PASS' : 'FAIL', res.ok ? 'reachable + authorized' : `HTTP ${res.status}`);
  } catch (e) { add('infra:supabase', 'FAIL', e.message); }

  // Resend API key valid (list domains; read-only, sends nothing).
  try {
    const res = await fetch('https://api.resend.com/domains', { headers: { Authorization: 'Bearer ' + g('RESEND_API_KEY') } });
    add('infra:resend', res.ok ? 'PASS' : 'FAIL', res.ok ? 'API key valid' : `HTTP ${res.status}`);
  } catch (e) { add('infra:resend', 'FAIL', e.message); }

  // Spotlight push function reachable + authorized (dry:true -> no push sent).
  try {
    const SB = g('EXPO_PUBLIC_SUPABASE_URL');
    const res = await fetch(`${SB}/functions/v1/spotlight`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + g('EXPO_PUBLIC_SUPABASE_ANON_KEY'),
        'x-cron-secret': g('CRON_SECRET') || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ city_id: 'findlay', title: 'Routine self-check dry run', body: 'Automated validation, nothing is sent.', dry: true }),
    });
    // 200 (audience), 422 (content lint), 429 (cooldown) all prove it is up + authorized.
    const healthy = [200, 422, 429].includes(res.status);
    add('infra:spotlight-fn', healthy ? 'PASS' : 'FAIL', healthy ? `reachable (HTTP ${res.status}, dry)` : `HTTP ${res.status}`);
  } catch (e) { add('infra:spotlight-fn', 'FAIL', e.message); }
}

// ---- report -----------------------------------------------------------------
const icon = { PASS: 'PASS ', FAIL: 'FAIL ', WARN: 'WARN ', SKIP: 'SKIP ' };
console.log('\n===============  LOCAL LOOP - ROUTINE SELF-CHECK  ===============');
console.log(QUICK ? '  mode: --quick (syntax + env only)\n' : '  mode: full (dry runs + connectivity, no sends)\n');
for (const r of results) console.log(`  ${icon[r.status] || r.status}  ${(r.routine + '                          ').slice(0, 26)} ${r.detail}`);
const fails = results.filter((r) => r.status === 'FAIL');
const warns = results.filter((r) => r.status === 'WARN');
console.log(`\n  ${results.filter((r) => r.status === 'PASS').length} pass · ${warns.length} warn · ${fails.length} fail`);
console.log('================================================================\n');
process.exit(fails.length ? 1 : 0);
