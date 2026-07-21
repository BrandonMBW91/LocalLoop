// Fill events.lat/lng from each event's address (for the map view). Geocodes
// each DISTINCT address once via Mapbox, then applies it to every event there —
// so ~1,700 events cost only a few hundred geocode calls.
//
// Usage:  node geocode.mjs            (fills events missing coords)
//         node geocode.mjs --dry-run  (look up, write nothing)
// Env (aggregator/.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MAPBOX_TOKEN

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { CITIES } from '../src/data/cities.js';
import { ANCHORS, milesBetween } from './geo.mjs';

loadDotEnv();
// Accepts BOTH spellings on purpose. The repo had scripts taking --dry and others
// taking --dry-run, so typing the wrong one at the wrong script ran it FOR REAL with no
// warning. That happened on 2026-07-21: 'seatgeek.mjs --dry' was a live import.
// Widening the match can only ever make a run more dry, never less.
const DRY = process.argv.includes('--dry-run') || process.argv.includes('--dry');
const ALL = process.argv.includes('--all'); // re-geocode everything, not just missing
const CITY_NAME = Object.fromEntries(CITIES.map((c) => [c.id, c.name]));

// Per-town center (bbox midpoint from the Census polygons) so a geocode that
// lands far from its ASSIGNED town — a same-name venue elsewhere ("John Bryan"
// in Yellow Springs vs Bryan; a multi-branch "all branches" library HQ) — can be
// rejected instead of dropping a pin tens-to-hundreds of miles away. The state
// footprint BBOX below can't catch this; the point is still inside Ohio.
const POLY = JSON.parse(readFileSync(new URL('./data/city-polygons.json', import.meta.url), 'utf8'));
const CENTER = Object.fromEntries(
  Object.entries(POLY).map(([id, p]) => [id, { lng: (p.bbox[0] + p.bbox[2]) / 2, lat: (p.bbox[1] + p.bbox[3]) / 2 }])
);
const MAX_TOWN_MI = 35; // a real venue for a town sits within ~this far of its center
// Mapbox API-level refusals (401/403/429/5xx), as distinct from "no match for this
// address". See the geocode() comment: conflating the two is what made a revoked token
// or an exhausted quota look like a night of unresolvable addresses.
let apiFailures = 0;
let badQueries = 0;   // 400/422: the address itself is unusable (usually over Mapbox 256-char cap)
let lastApiError = '';
// Stop the run rather than grind through thousands of doomed lookups. Small enough to
// catch a dead token on the first town, large enough that a couple of transient blips
// do not abort a healthy night.
const MAX_API_FAILURES = 25;
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MAPBOX_TOKEN } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MAPBOX_TOKEN) {
  console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or MAPBOX_TOKEN.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Accepted region = the union of every metro anchor's circle (plus a small
// margin), derived at runtime from geo.mjs so adding an anchor automatically
// expands where geocodes are accepted — no more hand-tuned magic bounding box
// silently rejecting a new region's events.
const MARGIN_MI = 10;
const BBOX = ANCHORS.reduce(
  (b, a) => {
    const dLat = (a.radius + MARGIN_MI) / 69; // ~69 mi per degree latitude
    const dLng = (a.radius + MARGIN_MI) / (69 * Math.cos((a.lat * Math.PI) / 180));
    return {
      s: Math.min(b.s, a.lat - dLat), n: Math.max(b.n, a.lat + dLat),
      w: Math.min(b.w, a.lng - dLng), e: Math.max(b.e, a.lng + dLng),
    };
  },
  { s: Infinity, n: -Infinity, w: Infinity, e: -Infinity }
);

// Geocode within our footprint, anchored to the town so a bare venue name
// ("Sandusky Library") doesn't match the same name in another state.
async function geocode(query) {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${MAPBOX_TOKEN}&limit=1&country=US&proximity=-83.65,41.04`;
  const res = await fetch(url);
  // A NOT-OK response is not "address not found" — it is the API refusing us, and the
  // two used to be indistinguishable because both returned null. That made the worst
  // failure in the codebase silent: if the token were revoked or the monthly quota ran
  // out, every address would come back "unresolvable", the run would exit 0, and new
  // events would just quietly stop getting map pins. Count these separately so the
  // caller can abort the run instead of writing off the whole night's addresses.
  if (!res.ok) {
    // Two different things wear the same "not ok" hat, and conflating them is what
    // makes this either blind or self-harming:
    //   400 / 422 — THIS QUERY is bad (Mapbox caps the search string at 256 chars, and
    //     some feed addresses are far longer). Address-specific and permanent, so it
    //     counts as a miss and earns a strike. Otherwise these retry twice a day forever.
    //   401 / 403 / 429 / 5xx — the API is refusing US. Global and usually temporary.
    //     Never record these against an address, or one quota blip blacklists hundreds
    //     of perfectly good addresses for a month.
    if (res.status === 400 || res.status === 422) {
      badQueries += 1;
      return null; // treated as "no match" by the caller, so it gets a strike
    }
    apiFailures += 1;
    lastApiError = `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) lastApiError += ' (token rejected)';
    if (res.status === 429) lastApiError += ' (rate limit or quota exhausted)';
    return null;
  }
  const data = await res.json();
  const f = data.features?.[0];
  if (!f?.center) return null;
  // Reject low-confidence matches. A vague/unresolvable address makes Mapbox
  // return a broad centroid (one bogus point shared by 100+ events — the Jul
  // 2026 audit found 156 pinned to a single PA-border coordinate). relevance
  // < 0.8 or a region/country-level match is not a real venue location.
  const badType = ['region', 'country', 'district'].some((t) => (f.place_type || []).includes(t));
  if (typeof f.relevance === 'number' && f.relevance < 0.8) return null;
  if (badType) return null;
  const [lng, lat] = f.center;
  // Reject anything outside the anchor-derived footprint (visible, not silent).
  if (lat < BBOX.s || lat > BBOX.n || lng < BBOX.w || lng > BBOX.e) return null;
  return { lng, lat };
}

// Addresses Mapbox has already said it cannot find. Loaded once per run so the same
// unanswerable question is not asked twice a day forever — see
// supabase/geocode_failures.sql for the measured cost of not doing this.
const MAX_ATTEMPTS = 3;       // give a shaky address three chances before backing off
const RETRY_AFTER_DAYS = 30;  // then try once more monthly: feed data gets cleaned up

async function loadFailures() {
  const out = new Map();
  let from = 0, page;
  do {
    const { data, error } = await supabase
      .from('geocode_failures').select('query, attempts, last_attempt_at').range(from, from + 999);
    // A read failure must NOT silently disable the skip — that would quietly restore
    // the old 1,800-a-day behaviour with nothing to show for it.
    if (error) { console.warn(`WARNING: could not read geocode_failures (${error.message}). Retrying every address this run.`); return new Map(); }
    page = data || [];
    for (const r of page) out.set(r.query, r);
    from += 1000;
  } while (page.length === 1000);
  return out;
}

async function main() {
  let from = 0, rows = [], page;
  do {
    let q = supabase.from('events').select('id, address, venue, city_id, lat');
    if (!ALL) q = q.is('lat', null);
    const r = await q.range(from, from + 999);
    page = r.data || [];
    rows.push(...page);
    from += 1000;
  } while (page.length === 1000);

  // Group by (address, town) so the same library across towns stays distinct.
  const groups = new Map();
  for (const e of rows) {
    const base = (e.address && e.address.trim()) || (e.venue && e.venue.trim());
    if (!base) continue;
    const town = CITY_NAME[e.city_id];
    const query = town ? `${base}, ${town}, OH` : base;
    const key = `${query}`;
    if (!groups.has(key)) groups.set(key, { query, ids: [], cityId: e.city_id });
    groups.get(key).ids.push(e.id);
  }

  // --all is an explicit "re-do everything", so it ignores the back-off.
  const failures = ALL ? new Map() : await loadFailures();
  const cutoff = Date.now() - RETRY_AFTER_DAYS * 86400e3;
  const isBackedOff = (q) => {
    const f = failures.get(q);
    return !!f && f.attempts >= MAX_ATTEMPTS && Date.parse(f.last_attempt_at) > cutoff;
  };

  const all = [...groups.values()];
  const todo = all.filter((g) => !isBackedOff(g.query));
  const skipped = all.length - todo.length;
  console.log(`${rows.length} events across ${groups.size} distinct address+town combos.`);
  if (skipped) console.log(`  skipping ${skipped} combo(s) that failed ${MAX_ATTEMPTS}+ times (retried after ${RETRY_AFTER_DAYS}d) — ${todo.length} to look up.`);

  let done = 0, updated = 0, missed = 0, farRejected = 0;
  const newFailures = [];
  const resolvedQueries = [];
  for (const { query, ids, cityId } of todo) {
    let coords = null;
    // Snapshot so we can tell "Mapbox has no match for this address" (worth
    // remembering) from "Mapbox refused the request" (must NEVER be remembered, or a
    // quota blip blacklists hundreds of good addresses for a month).
    const apiBefore = apiFailures;
    try { coords = await geocode(query); } catch {}
    const wasApiFailure = apiFailures > apiBefore;
    // Reject a geocode that landed too far from its assigned town (same-name
    // collision or a system-HQ address) so it falls back to no pin, not a wrong one.
    if (coords) {
      const ctr = CENTER[cityId];
      if (ctr && milesBetween(coords.lat, coords.lng, ctr.lat, ctr.lng) > MAX_TOWN_MI) { coords = null; farRejected += 1; }
    }
    done += 1;
    if (!coords) {
      missed += 1;
      // Remember genuine misses only. A far-rejected result counts: it DID resolve,
      // just to the wrong place, and asking again returns the same wrong answer.
      if (!wasApiFailure) newFailures.push(query);
      // Clear any stale/bad coords so a wrong pin doesn't linger.
      if (ALL && !DRY) {
        for (let i = 0; i < ids.length; i += 200) {
          await supabase.from('events').update({ lat: null, lng: null }).in('id', ids.slice(i, i + 200));
        }
      }
    } else {
      // It resolved — drop any past failure so a fixed address is not still counted
      // against its old strikes next month.
      if (failures.has(query)) resolvedQueries.push(query);
      if (!DRY) {
        for (let i = 0; i < ids.length; i += 200) {
          const slice = ids.slice(i, i + 200);
          const { error } = await supabase.from('events').update({ lat: coords.lat, lng: coords.lng }).in('id', slice);
          if (!error) updated += slice.length;
        }
      }
    }
    process.stdout.write(`\r  ${done}/${todo.length} combos · ${updated} events · ${missed} not found`);
    if (apiFailures >= MAX_API_FAILURES) {
      process.stdout.write('\n');
      throw new Error(
        `Mapbox refused ${apiFailures} requests in a row (last: ${lastApiError}). Stopping.\n` +
        `This is an API problem, not bad addresses — check the token and the monthly quota at\n` +
        `https://console.mapbox.com/. Nothing was written for the remaining combos.`,
      );
    }
    await new Promise((r) => setTimeout(r, 110)); // stay well under Mapbox rate limits
  }
  process.stdout.write('\n');

  // Persist the back-off state. Done in bulk at the end rather than per-combo so a run
  // costs two statements, not 900.
  if (!DRY) {
    if (newFailures.length) {
      const now = new Date().toISOString();
      const rowsUp = newFailures.map((q) => ({
        query: q,
        attempts: (failures.get(q)?.attempts || 0) + 1,
        last_attempt_at: now,
        last_reason: 'no match',
      }));
      for (let i = 0; i < rowsUp.length; i += 200) {
        const { error } = await supabase.from('geocode_failures')
          .upsert(rowsUp.slice(i, i + 200), { onConflict: 'query' });
        if (error) console.error('geocode_failures write failed:', error.message);
      }
    }
    if (resolvedQueries.length) {
      for (let i = 0; i < resolvedQueries.length; i += 200) {
        await supabase.from('geocode_failures').delete().in('query', resolvedQueries.slice(i, i + 200));
      }
      console.log(`  ${resolvedQueries.length} previously-failing address(es) resolved and cleared.`);
    }
  }

  console.log(DRY ? 'dry run — nothing written' : `Done. Geocoded ${updated} events.` + (farRejected ? ` (${farRejected} rejected as too far from town)` : ''));
  // Under the abort threshold but non-zero still means Mapbox turned us away some of
  // the time, which no amount of "not found" ever explains. Say so on its own line —
  // this used to be invisible.
  if (badQueries) console.log(`  ${badQueries} address(es) rejected by Mapbox as unusable (too long or malformed) — recorded, so they stop being retried.`);
  if (apiFailures) console.warn(`WARNING: ${apiFailures} Mapbox API failure(s) (last: ${lastApiError}). Those addresses were skipped, not resolved.`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
