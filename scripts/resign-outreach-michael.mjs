// Re-sign every outreach draft + follow-up from "Brandon" to "Michael", so the
// sender name matches the "Michael Williams" mailing address in the CAN-SPAM
// signature block. Idempotent (running twice is a no-op).
//   node scripts/resign-outreach-michael.mjs [--dry-run]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const DRY = process.argv.includes('--dry-run');

let changed = 0;
for (const sub of ['drafts', 'followups']) {
  const dir = join(ROOT, 'outreach', sub);
  let files;
  try { files = readdirSync(dir); } catch { continue; }
  for (const f of files) {
    if (!f.endsWith('.txt') || f === 'INDEX.txt') continue;
    const p = join(dir, f);
    const orig = readFileSync(p, 'utf8');
    const next = orig
      .replace(/^I'm Brandon,/gm, "I'm Michael,")   // intro line
      .replace(/^Brandon$/gm, 'Michael');            // signature line
    if (next !== orig) { changed++; if (!DRY) writeFileSync(p, next); }
  }
}
console.log(`${changed} draft(s) ${DRY ? 'would be ' : ''}re-signed Brandon -> Michael.`);
