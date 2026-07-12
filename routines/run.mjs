// routines/run.mjs - run any Local Loop routine on demand.
//
//   node routines/run.mjs                 list every routine and how to run it
//   node routines/run.mjs <id>            run its SAFE / dry path (no emails, no
//                                         pushes, no git push, no baseline write)
//   node routines/run.mjs <id> --live     run the REAL routine (may send / push)
//   node routines/run.mjs <id> --live --force   required for the flip/broadcast gate
//
// This is the on-demand counterpart to validate-routines.mjs. The scheduled
// tasks keep firing on their own cron; this just lets you trigger the same work
// yourself, defaulting to a no-side-effect run. Behavior lives in routines/<id>.md.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..'); // repo root (routines/ is one level down)

// On Windows a bare "bash" can resolve to WSL's System32 bash.exe, which runs
// with a Linux $HOME and can't read C:\ paths — sync-memory.sh would look for
// memory in the wrong place. Prefer Git Bash explicitly when it exists.
const GIT_BASH = 'C:/Program Files/Git/usr/bin/bash.exe';
// null (not a bare 'bash' fallback) when Git Bash is missing on Windows: bare
// 'bash' resolves to WSL's bash with a Linux $HOME, which would run
// sync-memory.sh against the wrong filesystem entirely.
const BASH = process.platform === 'win32' ? (existsSync(GIT_BASH) ? GIT_BASH : null) : 'bash';

// type: 'node' runs the script with this node; 'bash' runs it with bash.
// cwd is relative to the repo root. note explains what the mode actually does.
const ROUTINES = {
  'll-morning-brief': {
    desc: 'Ops brief: app metrics + pipeline health',
    safe: { type: 'node', args: ['daily-report.mjs'], cwd: '.', note: 'prints the daily report, sends nothing' },
    live: { type: 'node', args: ['daily-report.mjs', '--email'], cwd: '.', note: 'EMAILS the daily report to michabw91@gmail.com' },
    extra: 'Full routine also checks the overnight aggregate run + feed health and writes a summary; see routines/ll-morning-brief.md.',
  },
  'll-ad-test': {
    desc: 'Facebook ad test/control MAU tracker',
    safe: { type: 'node', args: ['ad-test-tracker.mjs', '--dry'], cwd: '.', note: 'prints the current read, no email, no baseline write' },
    live: { type: 'node', args: ['ad-test-tracker.mjs', '--email'], cwd: '.', note: 'EMAILS the report and (on the first run) captures the baseline' },
  },
  'll-evening-spotlight': {
    desc: 'Judge tonight; spotlight push only for a big hitter',
    safe: { type: 'node', args: ['spotlight-candidates.mjs'], cwd: 'aggregator', note: "prints tonight/tomorrow's candidates per town, read-only" },
    live: null,
    liveNote: 'No automated live run: choosing whether to push is a judgment call. Review the candidates above, then follow routines/ll-evening-spotlight.md to fire the push (with dry:true first).',
  },
  'll-outreach-send': {
    desc: 'Paced sponsor/food-truck outreach sender',
    safe: { type: 'node', args: ['send-queue.mjs', '--dry-run'], cwd: 'aggregator', note: 'lists what WOULD send, sends nothing' },
    // A real batch paces 2.5-5 min between emails, so a full quota run takes
    // 30-70 min; the default 10-min timeout would SIGTERM it mid-batch.
    live: { type: 'node', args: ['send-queue.mjs'], cwd: 'aggregator', note: 'SENDS real cold emails to leads (self-paced within its window)', timeout: 5400000 },
  },
  'll-memory-sync': {
    desc: 'Push this machine\'s Claude memory to the cloud repo',
    safe: null,
    safeNote: 'No dry run: this routine only pushes. Use --live to git-push memory to the cloud sync repo.',
    live: { type: 'bash', args: ['scripts/sync-memory.sh', 'push'], cwd: '.', note: 'GIT-PUSHES memory to the cloud sync repo' },
  },
  'localloop-release-gate-104': {
    desc: 'Arm the in-app update prompt when iOS 1.0.4 goes live',
    safe: { type: 'node', args: ['scripts/release-gate.mjs', '--dry-run'], cwd: '.', note: 'reports the App Store state, changes nothing (read-only ASC check)' },
    live: { type: 'node', args: ['scripts/release-gate.mjs'], cwd: '.', note: 'FLIPS the update gate + broadcast push IF 1.0.4 is live (else prints the current state)' },
    danger: true, // requires --live AND --force
  },
};

const argv = process.argv.slice(2);
const id = argv.find((a) => !a.startsWith('--'));
const LIVE = argv.includes('--live');
const FORCE = argv.includes('--force');

function listAll() {
  console.log('\nLocal Loop routines (node routines/run.mjs <id> [--live]):\n');
  for (const [k, r] of Object.entries(ROUTINES)) {
    const modes = [r.safe ? 'dry' : null, r.live ? (r.danger ? 'live+force' : 'live') : null].filter(Boolean).join(' / ') || 'manual';
    console.log(`  ${k.padEnd(28)} ${r.desc}`);
    console.log(`  ${''.padEnd(28)} modes: ${modes}`);
  }
  console.log('\n  Default is the dry/safe path. Add --live to actually send/push.');
  console.log('  Full logic for each routine is in routines/<id>.md.\n');
}

function runSpec(spec) {
  if (spec.type === 'bash' && !BASH) { console.error(`Git Bash not found at ${GIT_BASH}; refusing to fall back to WSL bash.`); process.exit(1); }
  const cmd = spec.type === 'node' ? process.execPath : spec.type === 'bash' ? BASH : spec.type;
  console.log(`\n> ${cmd === process.execPath ? 'node' : cmd} ${spec.args.join(' ')}  (cwd: ${spec.cwd})\n`);
  const r = spawnSync(cmd, spec.args, { cwd: join(ROOT, spec.cwd || '.'), stdio: 'inherit', timeout: spec.timeout || 600000 });
  if (r.error) { console.error(`\nrun error: ${r.error.message}`); process.exit(1); }
  process.exit(r.status || 0);
}

if (!id) { listAll(); process.exit(0); }
const r = ROUTINES[id];
if (!r) { console.error(`Unknown routine: ${id}`); listAll(); process.exit(1); }

if (LIVE) {
  if (!r.live) { console.log(`\n${id}: ${r.liveNote || 'no live run available.'}\n`); process.exit(0); }
  if (r.danger && !FORCE) {
    console.log(`\n!! ${id} is a real broadcast action: ${r.live.note}.`);
    console.log(`   To actually run it: node routines/run.mjs ${id} --live --force\n`);
    process.exit(0);
  }
  console.log(`\n[LIVE] ${id}: ${r.live.note}`);
  runSpec(r.live);
} else {
  if (!r.safe) { console.log(`\n${id}: ${r.safeNote || 'no dry run available; use --live.'}\n`); process.exit(0); }
  console.log(`\n[dry] ${id}: ${r.safe.note}`);
  runSpec(r.safe);
}
