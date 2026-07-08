// Preview the NEXT day's outreach batch — who gets emailed and where — by
// mirroring send-queue.mjs's exact selection logic (ramp quota + Findlay/Toledo/
// other round-robin). Read-only; sends nothing.
//   node preview-next-batch.mjs
// Note: uses the local sent-log.txt to determine who's already been emailed
// (the sender ALSO cross-checks the Zoho Sent folder, but the log mirrors it), so
// this is an accurate preview barring a send that never got logged.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CITIES } from '../src/data/cities.js';
import { orderPending } from './town-order.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTREACH = join(ROOT, 'outreach');
const readLines = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : []);

// --- queue (same parse as send-queue) ---
const draftsDir = join(OUTREACH, 'drafts');
const files = readdirSync(draftsDir).filter((f) => /^\d+.*\.txt$/.test(f)).sort();
const queue = files.map((f) => {
  const lines = readFileSync(join(draftsDir, f), 'utf8').split(/\r?\n/);
  return {
    to: ((lines[0].match(/^TO:\s*(.+)$/) || [])[1] || '').toLowerCase(),
    subject: (lines[1].match(/^SUBJECT:\s*(.+)$/) || [])[1] || '',
  };
}).filter((d) => d.to && d.subject);

const bounced = new Set(readLines(join(OUTREACH, 'bounced.txt')).map((l) => l.split(/\s+/)[0].toLowerCase()));
const logEntries = readLines(join(OUTREACH, 'sent-log.txt')).map((l) => (l.split(/\s+/)[1] || '').toLowerCase()).filter(Boolean);
const loggedTos = new Set(logEntries);
const goodAllTime = logEntries.filter((t) => !bounced.has(t)).length;

// tomorrow's quota: fresh day => goodToday 0 => need = ramp
const ramp = goodAllTime < 15 ? 5 : goodAllTime < 40 ? 8 : 10;
const quota = ramp;

// email -> {town, name, region}
const byEmail = {};
const regionByName = Object.fromEntries(CITIES.map((c) => [c.name, c.region]));
try {
  for (const b of JSON.parse(readFileSync(join(OUTREACH, 'businesses.json'), 'utf8'))) {
    const town = b.town || 'Findlay';
    byEmail[(b.email || '').toLowerCase()] = { town, name: b.name, region: regionByName[town] || '—' };
  }
} catch { /* fall back to bare emails */ }
const townOf = (to) => (byEmail[to] || {}).town || 'Findlay';

// same priority interleave as send-queue (shared town-order.mjs + town-weights.json)
let weights = null;
try { weights = JSON.parse(readFileSync(join(OUTREACH, 'town-weights.json'), 'utf8')).weights; }
catch { console.log('WARN: town-weights.json missing — run town-priority.mjs first'); }
const weightOf = (town) => (weights && weights[town] != null ? weights[town] : (town === 'Findlay' ? 2 : town === 'Toledo' ? 1.5 : 0));

const pending = orderPending(queue.filter((d) => !loggedTos.has(d.to) && !bounced.has(d.to)), { townOf, weightOf });
const batch = pending.slice(0, quota);

console.log(`queue ${queue.length} · already emailed ${loggedTos.size} · bounced ${bounced.size} · pending ${pending.length}`);
console.log(`good sends all-time ${goodAllTime} -> tomorrow's ramp quota = ${quota}\n`);
console.log(`=== TOMORROW'S BATCH (${batch.length}) ===`);
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
batch.forEach((d, i) => {
  const m = byEmail[d.to] || { name: '(unknown)', town: 'Other', region: '—' };
  console.log(`${String(i + 1).padStart(2)}. ${pad(m.name, 34)} ${pad(m.town + ' (' + m.region + ')', 30)} ${d.to}`);
});
const mix = {};
for (const d of batch) { const r = (byEmail[d.to] || {}).region || '—'; mix[r] = (mix[r] || 0) + 1; }
console.log('\nby region:', Object.entries(mix).map(([r, n]) => `${r} ${n}`).join(' · '));
const tmix = {};
for (const d of batch) { const t = townOf(d.to); tmix[t] = (tmix[t] || 0) + 1; }
console.log('by town:  ', Object.entries(tmix).map(([t, n]) => `${t} ${n}`).join(' · '));
