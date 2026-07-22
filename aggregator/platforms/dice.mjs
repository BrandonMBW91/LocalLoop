// DICE (dice.fm) — the ticketing platform independent music venues run their
// calendars on. Verified 2026-07-22 against Musica (Akron, 22 shows), Mahall's and
// The Roxy at Mahall's (Lakewood), The Foundry / Beachland / Grog Shop (Cleveland)
// and Woodlands Tavern / The Summit / King of Clubs (Columbus).
//   event_sources row: type 'dice', url = the venue's DICE page
//   (https://dice.fm/venue/musica-8qw5), city_id = fallback town, name = the
//   venue's name as DICE spells it (it becomes the event `host` and the fallback
//   filter). Adding another DICE venue is one row; no code changes. Append
//   ?ids=11725,14492 to pin the numeric venue id(s) and skip the page lookup.
//
// API (live-verified): GET https://partners-endpoint.dice.fm/api/v2/events
//     ?page[size]=200&types=linkout,event&filter[venue_ids][]=<id>
//   header x-api-key: <key>   (401 without one; there is no other auth)
// The key is the one DICE embeds in its own public event-list widget. It is NOT
// partner-scoped — the same key reads Musica, Beachland and Oxford UK — so one
// key serves every venue. DICE_API_KEY overrides it if it is ever rotated.
//
// Four traps this connector exists to avoid, each measured rather than assumed:
//   1. Omitting `types` returns only DICE-sold shows: 14 of Musica's 22.
//   2. filter[cities][] silently drops every `linkout` row too (same 14 of 22),
//      so the connector filters by VENUE and never by city.
//   3. filter[venues][]=<name> is exact and case-insensitive but resolves a venue
//      GROUP: "Mahall's" returns Mahall's + The Roxy at Mahall's + Mercury Music
//      Lounge, which would file three venues' shows under one `host`. Every row is
//      re-checked against the resolved venue, whichever filter was used.
//   4. `city` is a name and not a place — filter[cities][]=Oxford returns Oxford,
//      ENGLAND. Another reason town routing must come from the address, as it does.
//
// Rows arrive in two shapes. type 'event' sells on DICE: `url` is a link.dice.fm
// short link and the price lives in ticket_types[].price.total (cents, fees
// included). type 'linkout' sells somewhere else: `url` is null, `external_url`
// points at TicketWeb/etc, `ticket_types` is empty and the price is in `price`.
// Both are real shows and both are kept.

import { joinAddressParts } from '../venue.mjs';

const API = 'https://partners-endpoint.dice.fm/api/v2/events';
// DICE's own widget key, lifted from the public embed. Read-only and unscoped.
const WIDGET_KEY = 'A1XgRsnir2auvJeoQrfgC3lU6Sk7qAM23c2Zgg1C';
const UA = { 'User-Agent': 'Mozilla/5.0 (LocalLoop aggregator)' };
const trim = (s) => String(s || '').trim();

// Shows that are off. 'going_ahead' and 'rescheduled' both mean the listed date
// is the real one; 'postponed' means the date is now fiction, so it goes too.
const DEAD_FLAGS = new Set(['cancelled', 'canceled', 'postponed']);

// "Celebrity Etc presents: David Nail" is the promoter's billing, not the event.
// Stripping it earns its keep twice: readers want the act, and dedupe's subset
// test only merges the TicketWeb twin once those extra tokens are gone — with the
// prefix in place, 2 of Musica's 4 already-ingested shows survived as duplicates.
// The colon is the reliable marker; "X presents Y" without one is often the title.
export function stripPresenter(name) {
  const m = /^\s*(.{2,40}?)\s+presents:\s*(\S.*)$/i.exec(String(name || ''));
  return m && m[2].trim().length >= 3 ? m[2].trim() : trim(name);
}

// Cheapest all-in ticket price, in whole dollars where it divides evenly. Without
// this every DICE show would fall through to makeRow's text guess, which reads a
// gig with no "$" in its blurb as Free.
//
// A zero only means free when it came from a ticket_types row, i.e. a show DICE
// actually sells. On a linkout the money is handled on someone else's site and a
// bare `price: 0` is just as likely to mean "not stated" — printing Free on a
// paid show is the one error a reader turns up and gets caught by, so those say
// "See tickets" and let the link answer it.
export function priceOf(e) {
  const totals = (e.ticket_types || []).map((t) => t && t.price && t.price.total).filter((n) => Number.isFinite(n));
  if (totals.length) {
    const cents = Math.min(...totals);
    if (cents < 0) return null;
    if (cents === 0) return 'Free';
    return `$${dollarsOf(cents)}${new Set(totals).size > 1 ? '+' : ''}`;
  }
  if (!Number.isFinite(e.price) || e.price <= 0) return 'See tickets';
  return `$${dollarsOf(e.price)}`;
}

const dollarsOf = (cents) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

// Venues paste links straight out of Facebook, so an event URL can arrive with a
// click-tracker glued on. Those identify whoever shared it, not the event.
const TRACKING = /^(fbclid|gclid|gbraid|wbraid|msclkid|mc_eid|mc_cid|igshid|_ga|_gl|utm_[a-z_]+)$/i;
function cleanUrl(raw) {
  const s = trim(raw);
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return s;
  }
}

// links.next arrives pointing at events-api.dice.fm, which 403s this key. Keep the
// cursor, keep the host we are authorised on.
export function nextUrl(link) {
  const s = trim(link);
  if (!s) return null;
  try {
    return `${API}${new URL(s, API).search}`;
  } catch {
    return null;
  }
}

// The partners API exposes /events and nothing else — no venue lookup — so the
// numeric id normally comes out of the venue page's Next.js payload.
//
// `?ids=` on the source url pins it instead, with no page fetch at all. That
// exists for the two cases the page cannot serve: DICE sometimes holds a venue
// under more than one id (The Foundry is 11725 and 14492 at the same address, and
// only one has a public page), and a blocked or restyled dice.fm would otherwise
// drop every source back to name matching on the same day.
//
// Last resort is the source's own name, which stays safe because every row is
// re-checked against the resolved venue however we got here (trap 3 above).
export async function resolveVenue(source) {
  const name = trim(source.name);
  const url = trim(source.url);
  const pinned = (/[?&](?:ids|venue_ids)=([\d,\s]+)/.exec(url) || [])[1];
  if (pinned) {
    const ids = pinned.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length) return { ids, name };
  }
  const slug = (/\/venue\/([^/?#]+)/.exec(url) || [])[1];
  if (!slug) return { ids: [], name };
  try {
    const res = await fetch(`https://dice.fm/venue/${slug}`, { headers: UA });
    if (!res.ok) return { ids: [], name };
    const html = await res.text();
    const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    if (!m) return { ids: [], name };
    const v = JSON.parse(m[1])?.props?.pageProps?.profile?.venue;
    if (!v || v.id == null) return { ids: [], name };
    return { ids: [String(v.id)], name: trim(v.name) || name };
  } catch {
    return { ids: [], name }; // page moved or blocked — the name path still works
  }
}

export async function pull(source) {
  const key = process.env.DICE_API_KEY || WIDGET_KEY;
  const venue = await resolveVenue(source);
  if (!venue.ids.length && !venue.name) throw new Error('dice: no venue id or name to filter on');

  const url = new URL(API);
  url.searchParams.set('page[size]', '200');
  url.searchParams.set('types', 'linkout,event'); // trap 1: without this, linkouts vanish
  if (venue.ids.length) for (const id of venue.ids) url.searchParams.append('filter[venue_ids][]', id);
  else url.searchParams.append('filter[venues][]', venue.name);

  // Follow links.next rather than trusting one page. One page holds every Ohio
  // venue's calendar today, but a silent truncation would look exactly like a quiet
  // venue, and that is the failure this project keeps paying for.
  //
  // links.next cannot be followed verbatim: it is emitted against events-api.dice.fm,
  // which answers 403 Forbidden to this key. Same path, same query, different host —
  // measured, not guessed. Only the query is carried over.
  const raw = [];
  const seen = new Set();
  let next = url.toString();
  for (let page = 0; next && page < 10; page++) {
    const res = await fetch(next, { headers: { ...UA, 'x-api-key': key } });
    if (res.status === 401) throw new Error('dice: 401 — DICE_API_KEY rejected');
    if (!res.ok) throw new Error(`dice: HTTP ${res.status}`);
    const body = await res.json();
    const data = Array.isArray(body?.data) ? body.data : [];
    for (const e of data) if (e && e.id && !seen.has(e.id)) { seen.add(e.id); raw.push(e); }
    const link = nextUrl(body?.links?.next);
    next = link && link !== next ? link : null;
  }

  return raw.filter((e) => belongsTo(e, venue)).map((e) => toRawEvent(e, venue.name)).filter(Boolean);
}

// Trap 3, and it bites the id filter too: filter[venue_ids][]=9821 (Mahall's)
// returns 76 rows, 14 of which are in The Roxy at Mahall's or Mercury Music Lounge
// and merely list Mahall's as a SECOND entry in venues[]. Only venues[0] is the
// room the show is actually in, so that is the one that has to match — each of
// those rooms is its own event_sources row with its own id.
export function belongsTo(e, venue) {
  const primary = (e.venues || [])[0];
  const ids = venue.ids || [];
  if (ids.length && primary && primary.id != null) return ids.includes(String(primary.id));
  return !!venue.name && trim(primary?.name || e.venue).toLowerCase() === trim(venue.name).toLowerCase();
}

// One API event → the raw shape every connector hands back. null = drop it.
export function toRawEvent(e, fallbackVenue = '') {
  if ((e.flags || []).some((f) => DEAD_FLAGS.has(String(f).toLowerCase()))) return null;
  const start = new Date(e.date);
  if (Number.isNaN(start.getTime())) return null;
  const end = e.date_end ? new Date(e.date_end) : null;
  const venueName = trim((e.venues || [])[0]?.name) || trim(e.venue) || trim(fallbackVenue);
  const loc = e.location || {};
  const address = trim(e.address)
    || joinAddressParts([trim(loc.street), trim(loc.city), `${trim(loc.state)} ${trim(loc.zip)}`.trim()]);
  let description = trim(e.description) || trim(e.raw_description);
  // sold_out lives outside the title on purpose: source_uid hashes the title, so
  // folding it in would mint a second row the moment a show sold out.
  if (e.sold_out === true) description = description ? `Sold out.\n\n${description}` : 'Sold out.';
  return {
    summary: stripPresenter(e.name),
    description,
    location: joinAddressParts([venueName, address]),
    // 'event' rows sell on DICE, 'linkout' rows sell elsewhere; perm_name is the
    // last resort and is null on linkouts, so the order matters.
    url: cleanUrl(e.url) || cleanUrl(e.external_url) || (e.perm_name ? `https://dice.fm/event/${e.perm_name}` : null),
    image: trim(e.event_images?.landscape) || trim((e.images || [])[0]) || null,
    price: priceOf(e),
    start,
    end: end && !Number.isNaN(end.getTime()) && end > start ? end : null,
  };
}
