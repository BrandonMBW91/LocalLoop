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

// Collapse a trailing plural/possessive 's' so "Farmers" / "Farmer's" (which the
// tokenizer already reduces to "farmer") / "Farmer" and "Rocks" / "Rock" hash the
// same. Cross-source wording differs by this far more often than by a real word.
// It ONLY trims a plural 's' — never merges distinct words, so "Baby Storytime"
// vs "Baby & Toddler Storytime" still keep different signatures.
function stemWord(w) {
  return (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) ? w.slice(0, -1) : w;
}

export function titleSig(title) {
  // Significant words of the FULL title, sorted. No subtitle stripping — that
  // over-merged distinct series ("Summer Camp: A" vs "Summer Camp: B", "XRHL - X
  // vs Y" games). Reworded cross-source dupes are caught by venueKey instead.
  const s = String(title || '').toLowerCase();
  const words = (s.match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w)).map(stemWord);
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

// --- Ticketed cross-source twins ---------------------------------------------
// Ticketmaster/SeatGeek and a partner feed list the SAME concert or game with
// different wording ("Dogstar" vs "Dogstar: ALL IN NOW TOUR", "Columbus Clippers
// Game" vs "Columbus Clippers vs. Indianapolis Indians"). The exact keys above
// miss these, and title/venue similarity ALONE is unsafe (libraries run subset-
// titled programs like "STEAM Club" vs "Creation Station: STEAM Club" at many
// branches). The reliable separator: a real ticketing link. Library/campus
// registration URLs are never on these domains, so gating on the domain removes
// every branch-program false positive while catching the concert twins.
const TICKETING = /ticketmaster|seatgeek|livenation|axs\.com|ticketweb|etix|dice\.fm|eventbrite|bandsintown|songkick|tixr|universe\.com/i;
const isTicketed = (e) => TICKETING.test(e.ticket_url || '');

// Venue-type and city words are too generic to prove two venues are the same one.
const GENERIC_VENUE_WORD = new Set(['ohio', 'street', 'avenue', 'road', 'drive', 'suite', 'united', 'state', 'park', 'center', 'centre', 'hall', 'theatre', 'theater', 'arena', 'stadium', 'building', 'columbus', 'cleveland', 'cincinnati', 'akron', 'toledo', 'dayton']);
const sigTitleTokens = (title) => new Set((String(title || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w)).map(stemWord));
const venueTokens = (venue) => new Set((String(venue || '').toLowerCase().match(/[a-z0-9]{4,}/g) || []).map(stemWord).filter((w) => !GENERIC_VENUE_WORD.has(w)));
const shareToken = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
// One title's significant words wholly inside the other's (smaller must be non-empty).
function titleSubset(a, b) {
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  if (!s.size) return false;
  for (const x of s) if (!l.has(x)) return false;
  return true;
}

// Are two same-slot events the same ticketed concert/game worded differently?
// Caller guarantees same city|day|hour. Requires a ticketing link on at least
// one side, overlapping venue cores, and one title subsuming the other.
export function isTicketedTwin(a, b) {
  if (!(isTicketed(a) || isTicketed(b))) return false;
  if (!shareToken(venueTokens(a.venue), venueTokens(b.venue))) return false;
  return titleSubset(sigTitleTokens(a.title), sigTitleTokens(b.title));
}


// Same venue, same exact start INSTANT, and one title is a prefix of the other
// ('Tuesdays at the Park' vs 'Tuesdays at the Park: Indiana Wild', 'BGSU Men's
// Soccer vs Wright State' with a network suffix appended). The subtitle carries
// no separate event — one feed just truncates or decorates the title.
export function isPrefixTwin(a, b) {
  if (a.start_at !== b.start_at) return false;
  const va = venueSig(a.venue), vb = venueSig(b.venue);
  if (!va || va !== vb) return false;
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const ta = norm(a.title), tb = norm(b.title);
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return shorter.length >= 12 && longer.startsWith(shorter);
}

const jaccard = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / ((a.size + b.size - i) || 1); };

// The SAME real event listed by two DIFFERENT sources at different clock times —
// Ticketmaster's noon-TBD kickoff vs SeatGeek's real one, or a library talk
// cross-posted to Eventbrite. Caller guarantees same city|day (NOT same hour).
// Different hosts are REQUIRED so a single venue's genuine matinee + evening of
// the same show (both from one source) is never collapsed.
export function isCrossSourceDayTwin(a, b) {
  if (!a.host || !b.host || a.host === b.host) return false;
  if (isTicketedTwin(a, b)) return true; // subset title + venue overlap + a ticket link
  const ta = sigTitleTokens(a.title), tb = sigTitleTokens(b.title);
  if (ta.size < 2 || tb.size < 2 || jaccard(ta, tb) < 0.8) return false; // near-identical title
  const va = venueTokens(a.venue), vb = venueTokens(b.venue);
  return !va.size || !vb.size || shareToken(va, vb); // compatible venue (one blank ok)
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
  // Union-find over events: any two that a rule links land in one component, so a
  // three-way twin (Ticketmaster + SeatGeek + partner feed) collapses to one row.
  const parent = all.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  // Rule 1 (conservative, unchanged): same title AND venue AND hour. Won't merge
  // distinct series (different titles) or a shared title at different branches.
  const byKey = new Map();
  all.forEach((e, i) => {
    const k = `${dedupeKey(e.city_id, e.title, e.start_at)}|${venueSig(e.venue)}`;
    (byKey.get(k) || byKey.set(k, []).get(k)).push(i);
  });
  for (const idxs of byKey.values()) for (let j = 1; j < idxs.length; j++) union(idxs[0], idxs[j]);

  // Rule 2 (ticketed twins): same city|day|hour, compared pairwise inside the
  // bucket (tiny n, and no cross-day/city merge is even possible). See isTicketedTwin.
  const byBucket = new Map();
  all.forEach((e, i) => {
    const k = `${e.city_id}|${etDay(e.start_at)}|${etHour(e.start_at)}`;
    (byBucket.get(k) || byBucket.set(k, []).get(k)).push(i);
  });
  for (const idxs of byBucket.values()) {
    if (idxs.length < 2) continue;
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        if (isTicketedTwin(all[idxs[a]], all[idxs[b]])) union(idxs[a], idxs[b]);
        else if (isPrefixTwin(all[idxs[a]], all[idxs[b]])) union(idxs[a], idxs[b]);
      }
    }
  }

  // Rule 3 (cross-source day twins): same city|DAY, ignoring hour, for the same
  // event listed by two different sources at mismatched times. See isCrossSourceDayTwin.
  const byDay = new Map();
  all.forEach((e, i) => {
    const k = `${e.city_id}|${etDay(e.start_at)}`;
    (byDay.get(k) || byDay.set(k, []).get(k)).push(i);
  });
  for (const idxs of byDay.values()) {
    if (idxs.length < 2) continue;
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        if (isCrossSourceDayTwin(all[idxs[a]], all[idxs[b]])) union(idxs[a], idxs[b]);
      }
    }
  }

  // Gather components.
  const comps = new Map();
  all.forEach((e, i) => { const r = find(i); (comps.get(r) || comps.set(r, []).get(r)).push(e); });

  const remove = [];
  const examples = [];
  for (const evs0 of comps.values()) {
    // Offset pagination can return the same row twice if a matching row lands
    // concurrently mid-scan — collapse by id so a real event's only copy is never
    // queued for deletion against itself.
    const seenIds = new Set();
    const evs = evs0.filter((e) => (seenIds.has(e.id) ? false : seenIds.add(e.id)));
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
