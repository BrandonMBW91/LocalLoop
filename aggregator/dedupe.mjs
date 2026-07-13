// Shared cross-source de-duplication.
//
// The per-source `source_uid` (sha1 of city|title|start) only catches EXACT
// repeats. When two different sources list the same event with slightly different
// wording or minute-off times (Ticketmaster "Jim Gaffigan: Everything is
// Wonderful!" vs SeatGeek "Jim Gaffigan"), the source_uids differ and a duplicate
// survives. `dedupeKey` is a fuzzier signature that collapses those:
//   city | Eastern-day | Eastern-hour | sorted significant title words
//
// Same headliner, same city, same hour, same day => same key => one event.
// Different times (10am vs 2pm storytime) keep different keys => both survive.
//
//   import { dedupeKey } from './dedupe.mjs'   // connectors skip existing keys
//   node dedupe.mjs                            # report cross-source dupes (dry)
//   node dedupe.mjs --apply                    # remove them, keeping the richest
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';

const TZ = 'America/New_York';
const etDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const etHour = (iso) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date(iso))) % 24;

// Words too generic to distinguish one event from another.
const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'at', 'in', 'on', 'for', 'to', 'with', 'live', 'tour', 'concert', 'show', 'presents', 'presented', 'featuring', 'feat', 'ft', 'vs', 'versus', 'night', 'ohio', 'event', 'tickets', 'ticket', 'the', 'experience', 'series']);

export function titleSig(title) {
  // Significant words of the FULL title, sorted. No subtitle stripping — that
  // over-merged distinct series ("Summer Camp: A" vs "Summer Camp: B", "XRHL - X
  // vs Y" games). Reworded cross-source dupes are caught by venueKey instead.
  const s = String(title || '').toLowerCase();
  const words = (s.match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w));
  return words.sort().join(' ') || s.replace(/[^a-z0-9]/g, '');
}

export function dedupeKey(cityId, title, startISO) {
  return `${cityId}|${etDay(startISO)}|${etHour(startISO)}|${titleSig(title)}`;
}

// A second signature keyed on the VENUE, for when two sources word the title
// differently but it's plainly the same event (e.g. "Team A at Team B" vs
// "Team B vs. Team A" at the same ballpark and hour). Strips the "(Toledo)" /
// "- Toledo" suffixes sources tack on so the venue cores match. Returns null for
// venues too short/generic to trust (so concurrent library programs never merge).
export function venueSig(venue) {
  const core = String(venue || '').split(/[(–—-]/)[0];
  return (core.toLowerCase().match(/[a-z0-9]{3,}/g) || []).sort().join('');
}
export function venueKey(cityId, venue, startISO) {
  const vs = venueSig(venue);
  return vs.length >= 6 ? `${cityId}|${etDay(startISO)}|${etHour(startISO)}|v:${vs}` : null;
}

// How "rich" a row is — the winner of a duplicate set is the one worth keeping.
function richness(e) {
  return (e.image_url ? 2 : 0) + (e.ticket_url ? 2 : 0) + (e.end_at ? 1 : 0)
    + (e.venue && e.venue.length > 3 ? 1 : 0) + (e.description ? 1 : 0);
}

async function sweep(apply) {
  loadDotEnv();
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date().toISOString();
  // Only aggregator rows (source_uid not null). NEVER touch user submissions.
  let all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('events')
      .select('id,city_id,title,start_at,end_at,venue,image_url,ticket_url,description,host,source_uid')
      .eq('status', 'approved').not('source_uid', 'is', null).gte('start_at', now)
      .order('id', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  const groups = new Map();
  for (const e of all) {
    // Conservative: same title AND same venue AND same hour. Won't merge distinct
    // series (different titles) or a shared title at different branches (diff venue).
    const k = `${dedupeKey(e.city_id, e.title, e.start_at)}|${venueSig(e.venue)}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(e);
  }
  // Offset pagination can return the same row twice if a matching row lands
  // concurrently mid-scan — the row would then group with ITSELF and its own id
  // (the only copy of a real event) would be queued for deletion. Collapse by id.
  for (const [k, evs] of groups) {
    const seenIds = new Set();
    groups.set(k, evs.filter((e) => (seenIds.has(e.id) ? false : seenIds.add(e.id))));
  }
  const remove = [];
  const examples = [];
  for (const [, evs] of groups) {
    if (evs.length < 2) continue;
    evs.sort((a, b) => richness(b) - richness(a) || String(a.source_uid).localeCompare(String(b.source_uid)));
    const keep = evs[0];
    for (const dup of evs.slice(1)) remove.push(dup.id);
    if (examples.length < 12) examples.push(`  keep "${keep.title}" (${keep.host}) · drop ${evs.length - 1}: ${evs.slice(1).map((d) => `"${d.title}" (${d.host})`).join(', ')}`);
  }
  console.log(`scanned ${all.length} aggregator events · ${remove.length} duplicate(s) across ${examples.length ? 'multiple' : 'no'} groups`);
  examples.forEach((x) => console.log(x));
  if (!remove.length) { console.log('no cross-source duplicates. clean.'); return; }
  if (!apply) { console.log(`\n(dry run) re-run with --apply to remove ${remove.length} duplicate(s).`); return; }
  let deleted = 0;
  for (let i = 0; i < remove.length; i += 100) {
    const { error } = await sb.from('events').delete().in('id', remove.slice(i, i + 100));
    if (error) { console.error('delete error:', error.message); break; }
    deleted += remove.slice(i, i + 100).length;
  }
  console.log(`removed ${deleted} duplicate(s), kept the richest of each set.`);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('dedupe.mjs')) {
  sweep(process.argv.includes('--apply')).catch((e) => { console.error(e); process.exit(1); });
}
