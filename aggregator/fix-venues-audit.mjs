// One-shot backfill for the Jul 2026 venue-quality audit. Applies to live rows
// what the ingestion pipeline now does for new ones:
//   1. strip room-capacity noise "(Capacity : 65)" and trailing ", USA"/", United States"
//   2. collapse doubled address segments (TM/SG city/state/zip repeats)
//   3. WhoFi branch promotion: description's first line names a branch the venue
//      lacks -> venue = branch, address cleared (main building's street was wrong)
//   4. drop the 'See venue' placeholder (app hides Follow/directions on blank)
// Dry by default; --apply writes. Scope: approved aggregator rows, upcoming OR
// still running.
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { joinAddressParts } from './venue.mjs';

const APPLY = process.argv.includes('--apply');

function stripNoise(s) {
  return String(s || '')
    .replace(/\(\s*capacity\s*:?\s*\d+\s*\)/gi, ' ')
    .replace(/,?\s*(?:USA|U\.S\.A\.|United States(?: of America)?)\s*$/i, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[\s,;:-]+/, '')
    .replace(/[\s,;:-]+$/, '')
    .trim();
}

function fixRow(r) {
  let venue = stripNoise(r.venue);
  let address = stripNoise(r.address);
  if (address) address = joinAddressParts(address.split(','));
  if (venue) venue = joinAddressParts(venue.split(','));
  if (/^see venue$/i.test(venue)) venue = '';
  const firstLine = String(r.description || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const branchM = /^((?:[A-Z][A-Za-z.'&-]*\s+){1,4}Branch(?:\s+Library)?)(?=\s|$)/.exec(firstLine);
  const branchName = branchM ? branchM[1].trim() : '';
  const branchStem = branchName.toLowerCase().replace(/\s+branch(?:\s+library)?$/, '').trim();
  if (branchName && venue && !['the', 'a', 'an', 'our', 'this'].includes(branchStem)
      && !venue.toLowerCase().includes(branchStem)) {
    venue = branchName;
    address = '';
  }
  return { venue, address };
}

loadDotEnv();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const nowIso = new Date().toISOString();
let rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('events')
    .select('id,venue,address,description,host')
    .eq('status', 'approved').not('source_uid', 'is', null)
    .or(`start_at.gte.${nowIso},end_at.gte.${nowIso}`)
    .range(from, from + 999);
  if (error) { console.error('read ERR', error.message); process.exit(1); }
  rows.push(...(data || []));
  if (!data || data.length < 1000) break;
}

let changed = 0, applied = 0, failed = 0;
const samples = [];
for (const r of rows) {
  const f = fixRow(r);
  if (f.venue === (r.venue || '') && f.address === (r.address || '')) continue;
  changed++;
  if (samples.length < 8) samples.push({ before: `${r.venue} | ${r.address}`, after: `${f.venue} | ${f.address}` });
  if (APPLY) {
    const { error } = await sb.from('events').update({ venue: f.venue, address: f.address }).eq('id', r.id);
    if (error) failed++; else applied++;
  }
}
console.log(`scanned ${rows.length} rows · ${changed} need fixing${APPLY ? ` · applied ${applied} · failed ${failed}` : ' (dry run — use --apply)'}`);
samples.forEach((s) => { console.log('  BEFORE:', s.before.slice(0, 90)); console.log('  AFTER :', s.after.slice(0, 90)); });
