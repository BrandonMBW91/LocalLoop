// The whole aggregation pipeline, in the correct order, with one command:
//   node run-all.mjs
// Feeds first, then the ticketed APIs (they de-dupe against what's already there),
// then LibraryMarket, then a final de-dup sweep, then geocode, then the website
// pages. Each step is isolated — one failing never aborts the rest.
// NOTE: keep this list in lock-step with the step order in
// .github/workflows/aggregate.yml — that's the daily cron; this is the manual run.
import { execSync } from 'node:child_process';

const STEPS = [
  ['Feeds (iCal / JSON-LD)', 'aggregate.mjs'],
  ['Ticketmaster', 'ticketmaster.mjs'],
  ['SeatGeek', 'seatgeek.mjs'],
  ['LibraryMarket', 'librarymarket.mjs'],
  ['De-duplicate', 'dedupe.mjs --apply'],
  ['Geocode', 'geocode.mjs'],
  ['Website pages', 'generate-events.mjs'],
  ['Advertise page', 'generate-advertise.mjs'],
];

let failures = 0;
for (const [label, cmd] of STEPS) {
  console.log(`\n═══════════ ${label} ═══════════`);
  try {
    execSync(`node ${cmd}`, { stdio: 'inherit', cwd: import.meta.dirname });
  } catch (e) {
    failures++;
    console.error(`  ✗ ${label} failed (continuing): ${e.message}`);
  }
}
console.log(`\n${failures ? '⚠' : '✔'} pipeline complete${failures ? ` — ${failures} step(s) failed` : ''}`);
