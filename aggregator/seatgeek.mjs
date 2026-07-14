// Pull ticketed events from the SeatGeek Platform API. Layers on top of
// Ticketmaster; the two overlap heavily, so this de-dupes against everything
// already in the DB (fuzzy dedupeKey) before writing — no double concerts.
//
//   node seatgeek.mjs              # pull + write
//   node seatgeek.mjs --dry-run    # print, write nothing
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { cityFromLocation } from './towns.mjs';
import { dedupeKey, venueKey } from './dedupe.mjs';
import { joinAddressParts, cleanEventTitle } from './venue.mjs';
import { ANCHORS } from './geo.mjs';

loadDotEnv();
const DRY = process.argv.includes('--dry-run');
const CID = process.env.SEATGEEK_CLIENT_ID;
const HORIZON_DAYS = 90;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
function toIso(dt) {
  if (!dt) return null;
  const s = dt.replace(' ', 'T');
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z'); // SeatGeek datetime_utc is UTC without a 'Z'
  return isNaN(d) ? null : d.toISOString();
}
function category(ev) {
  const s = `${ev.type || ''} ${(ev.taxonomies || []).map((t) => t.name || '').join(' ')}`.toLowerCase();
  if (/family|kids|children/.test(s)) return 'Family';
  if (/sport|mlb|nba|nfl|nhl|ncaa|soccer|hockey|baseball|basketball|football|wrestl|racing|rodeo/.test(s)) return 'Sports';
  if (/theat|broadway|comedy|classical|dance|opera|ballet|cirque|film/.test(s)) return 'Arts';
  if (/concert|music|festival|band/.test(s)) return 'Music';
  return 'Community';
}
const EMOJI = { Music: '🎶', Family: '👨‍👩‍👧', Sports: '🏅', Arts: '🎨', Community: '🤝' };

async function fetchAnchor(a) {
  const now = new Date().toISOString().slice(0, 19) + 'Z';
  const end = new Date(Date.now() + HORIZON_DAYS * 86400000).toISOString().slice(0, 19) + 'Z';
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const url = `https://api.seatgeek.com/2/events?client_id=${CID}&lat=${a.lat}&lon=${a.lng}&range=${a.radius}mi`
      + `&per_page=100&page=${page}&datetime_utc.gte=${encodeURIComponent(now)}&datetime_utc.lte=${encodeURIComponent(end)}&sort=datetime_utc.asc`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`);
    const j = await r.json();
    const evs = j.events || [];
    out.push(...evs);
    if (evs.length === 0 || out.length >= (j.meta?.total || 0)) break;
  }
  return out;
}

function toRow(ev, cityId) {
  const title = clean(ev.title);
  const startIso = toIso(ev.datetime_utc || ev.datetime_local);
  if (!title || !startIso) return null;
  const v = ev.venue || {};
  // The lat/radius query spills across state lines (Grand Rapids MI showed under
  // Defiance, Monroe MI under Toledo). This is an Ohio app: OH venues only.
  if (v.state && String(v.state).toUpperCase() !== 'OH') return null;
  // joinAddressParts skips parts v.address already carries (SG packs city/state/zip in too).
  const address = clean(joinAddressParts([v.address, v.city, v.state, v.postal_code]));
  const assigned = cityFromLocation(`${v.name || ''} ${v.city || ''} ${address}`, cityId);
  if (!assigned) return null;
  const price = ev.stats?.lowest_price != null ? `$${Math.round(ev.stats.lowest_price)}+` : 'See tickets';
  const cat = category(ev);
  return {
    city_id: assigned, title: cleanEventTitle(title, assigned) || title, category: cat, emoji: EMOJI[cat] || '📅',
    start_at: startIso, end_at: null, venue: clean(v.name), address, // no 'See venue' placeholder
    price, host: 'SeatGeek', description: clean(ev.description || `${title} — tickets via SeatGeek.`),
    source_uid: createHash('sha1').update(`${assigned}|${title.toLowerCase()}|${startIso}`).digest('hex').slice(0, 24),
    lat: v.location?.lat ?? null, lng: v.location?.lon ?? null,
    image_url: ev.performers?.[0]?.image || null,
    ticket_url: /^https:\/\//.test(ev.url || '') ? ev.url : null,
  };
}

async function main() {
  if (!CID) { console.error('Missing SEATGEEK_CLIENT_ID in aggregator/.env'); process.exit(1); }
  const seenUid = new Set(), seenKey = new Set(), rows = [];
  for (const a of ANCHORS) {
    let evs = [];
    try { evs = await fetchAnchor(a); } catch (e) { console.error(`  ! ${a.name}: ${e.message}`); continue; }
    let n = 0;
    for (const ev of evs) {
      const row = toRow(ev, a.city);
      if (!row) continue;
      const tk = dedupeKey(row.city_id, row.title, row.start_at);
      const vk = venueKey(row.city_id, row.venue, row.start_at);
      if (seenUid.has(row.source_uid) || seenKey.has(tk) || (vk && seenKey.has(vk))) continue; // within-SeatGeek dupes
      seenUid.add(row.source_uid); seenKey.add(tk); if (vk) seenKey.add(vk);
      rows.push(row); n++;
    }
    if (n) console.log(`  ${a.name}: ${n}`);
  }
  console.log(`\n${rows.length} unique SeatGeek events pulled`);

  // De-dupe against EVERYTHING already in the DB (Ticketmaster, feeds) via the fuzzy key.
  loadDotEnv();
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date().toISOString();
  const existingKeys = new Set();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from('events').select('city_id,title,start_at,venue').eq('status', 'approved').gte('start_at', now).range(from, from + 999);
    (data || []).forEach((e) => { existingKeys.add(dedupeKey(e.city_id, e.title, e.start_at)); const vk = venueKey(e.city_id, e.venue, e.start_at); if (vk) existingKeys.add(vk); });
    if (!data || data.length < 1000) break;
  }
  const fresh = rows.filter((r) => {
    const vk = venueKey(r.city_id, r.venue, r.start_at);
    return !existingKeys.has(dedupeKey(r.city_id, r.title, r.start_at)) && !(vk && existingKeys.has(vk));
  });
  const dupeCount = rows.length - fresh.length;
  console.log(`${dupeCount} overlapped existing events (Ticketmaster/feeds) and were dropped; ${fresh.length} genuinely new`);

  if (DRY) { fresh.slice(0, 12).forEach((r) => console.log(`    • ${r.start_at.slice(0, 16)} [${r.category}] ${r.title} @ ${r.venue} (${r.city_id})`)); console.log('\n(dry run — nothing written)'); return; }
  if (!fresh.length) { console.log('nothing new to add.'); return; }
  const { data, error } = await sb.from('events').upsert(fresh, { onConflict: 'source_uid', ignoreDuplicates: true }).select('id');
  if (error) { console.error('write error:', error.message); process.exit(1); }
  console.log(`Added ${data ? data.length : 0} new SeatGeek event(s).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
