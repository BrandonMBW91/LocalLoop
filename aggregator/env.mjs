// Load aggregator/.env AND the repo-root .env (both gitignored) into process.env, so
// the scripts "just work" locally without exporting vars by hand. Real values set in
// the environment (e.g. GitHub Action secrets) take precedence — we never overwrite.
//
// Reading BOTH files matters. The two accumulated different keys: Supabase creds live
// in aggregator/.env, while RESEND_API_KEY only ever lived in the root .env. Anything
// in aggregator/ that sends mail therefore found no key and took its "cannot send"
// branch — locally silent, and easy to misread as "there was nothing to send".
// feed-health-alert.mjs sat in exactly that state. aggregator/.env is read LAST so it
// still wins on any key both files define, which preserves existing behaviour.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export function loadDotEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const file of [join(here, '..', '.env'), join(here, '.env')]) {
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; } // absent is fine
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      const val = m[2].trim().replace(/^["']|["']$/g, '');
      if (val && process.env[key] === undefined) process.env[key] = val;
    }
  }
}
