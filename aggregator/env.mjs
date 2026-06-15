// Load aggregator/.env (gitignored) into process.env if present, so the scripts
// "just work" locally without exporting vars by hand. Real values set in the
// environment (e.g. GitHub Action secrets) take precedence — we never overwrite.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export function loadDotEnv() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const text = readFileSync(join(here, '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      const val = m[2].trim().replace(/^["']|["']$/g, '');
      if (val && process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // no .env file — fine, vars may be set another way
  }
}
