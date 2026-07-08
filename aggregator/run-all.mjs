// The whole aggregation pipeline, in the correct order, with one command:
//   node run-all.mjs
// Feeds first, then the ticketed APIs (they de-dupe against what's already there),
// then LibraryMarket, then a final de-dup sweep, then geocode, then the website
// pages. Each step is isolated — one failing never aborts the rest.
// NOTE: keep this list in lock-step with the step order in
// .github/workflows/aggregate.yml — that's the daily cron; this is the manual run.
import { execSync } from 'node:child_process';

// `{ hard: true }` steps FAIL the whole run (non-zero exit) so CI can block a bad
// deploy; soft steps (feeds, generators) only warn and continue, so one flaky feed
// never aborts the pipeline. check-cities is a hard config gate. The content guard
// runs as a REPORT for now — flip it to 'check-content.mjs --strict' + { hard: true }
// once every picker town has content (see the legacy ghosts it lists).
const STEPS = [
  ['Validate city config', 'check-cities.mjs', { hard: true }],
  ['Feeds (iCal / JSON-LD)', 'aggregate.mjs'],
  ['Ticketmaster', 'ticketmaster.mjs'],
  ['SeatGeek', 'seatgeek.mjs'],
  ['LibraryMarket', 'librarymarket.mjs'],
  ['De-duplicate', 'dedupe.mjs --apply'],
  ['Geocode', 'geocode.mjs'],
  ['Content guard (ghost/thin report)', 'check-content.mjs'],
  ['Website pages', 'generate-events.mjs'],
  ['Advertise page', 'generate-advertise.mjs'],
];

let failures = 0;
let hardFailures = 0;
for (const [label, cmd, opts = {}] of STEPS) {
  console.log(`\n═══════════ ${label} ═══════════`);
  try {
    execSync(`node ${cmd}`, { stdio: 'inherit', cwd: import.meta.dirname });
  } catch (e) {
    failures++;
    if (opts.hard) hardFailures++;
    console.error(`  ✗ ${label} failed${opts.hard ? '' : ' (continuing)'}: ${e.message}`);
  }
}
console.log(`\n${failures ? '⚠' : '✔'} pipeline complete${failures ? ` — ${failures} step(s) failed` : ''}`);
process.exit(hardFailures ? 1 : 0);
