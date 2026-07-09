// One-time re-sign of all outreach copy from "Brandon" to "Michael" (user
// directive Jul 9 2026 — public-facing name is Michael / Michael Williams).
// RUN ON THE DESKTOP (the machine that owns outreach/) from the repo root:
//   node scripts/resign-outreach-michael.mjs           # apply
//   node scripts/resign-outreach-michael.mjs --dry-run # count only
// Idempotent: rewrites the standalone "Brandon" signature line and the
// "I'm Brandon," intro in queued drafts, follow-ups, and the two draft
// assemblers. Already-sent emails are unaffected (this only edits files the
// sender reads going forward).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO, 'outreach');
const DRY = process.argv.includes('--dry-run');

const resign = (text) => text
  .replaceAll("I'm Brandon,", "I'm Michael,")
  .replace(/^Brandon$/gm, 'Michael');

let files = 0, hits = 0;
const fix = (path) => {
  const before = readFileSync(path, 'utf8');
  const after = resign(before);
  if (after !== before) {
    hits++;
    if (!DRY) writeFileSync(path, after);
  }
  files++;
};

for (const dir of ['drafts', 'followups']) {
  const d = join(OUT, dir);
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d)) if (f.endsWith('.txt')) fix(join(d, f));
}
for (const f of ['assemble-drafts.cjs', 'assemble-truck-drafts.mjs']) {
  if (existsSync(join(OUT, f))) fix(join(OUT, f));
}

console.log(`${hits} file(s) ${DRY ? 'would be ' : ''}re-signed Michael (of ${files} scanned).`);
if (!DRY && hits) console.log('Spot-check one draft, then the sender uses the new signature from its next run.');
