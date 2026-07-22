// Unit tests for the DICE connector. Run: node tests/dice.test.mjs
//
// Every fixture below is a REAL row from the DICE partners API on 2026-07-22
// (Musica in Akron, Mahall's and The Roxy at Mahall's in Lakewood), trimmed to the
// fields the connector reads. The connector's behaviour was validated by hand
// against the live API while it was written; this file is that validation frozen,
// so a later tweak cannot quietly re-break it.
//
// The three things most worth guarding, all of which were real bugs during the build:
//   - venue GROUPS. filter[venue_ids][]=9821 returns Roxy and Mercury shows too,
//     because they list Mahall's as a second venue. Only venues[0] is the room.
//   - "Celebrity Etc presents: David Nail". With the promoter prefix left on,
//     2 of Musica's 4 already-ingested shows survived dedupe as duplicates.
//   - price. A linkout's `price: 0` means "not stated", not free.
import assert from 'node:assert';
import { stripPresenter, priceOf, belongsTo, toRawEvent, nextUrl, resolveVenue } from '../aggregator/platforms/dice.mjs';
import { isTicketedTwin } from '../aggregator/dedupe.mjs';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('  FAIL:', name, '\n         ', e.message); } };

// --- real API rows -------------------------------------------------------------

// Sells on DICE: link.dice.fm url, price in ticket_types, full description.
const ANGELA = {
  id: '6a4d489cd844a6000119042d',
  type: 'event',
  name: 'Angela Perley & Sparkle Carcass with special guest Zach Angeloni',
  date: '2026-07-23T23:30:00Z',
  date_end: '2026-07-24T03:30:00Z',
  venue: 'Musica',
  venues: [{ id: 11682, name: 'Musica', city: { name: 'Akron' } }],
  address: '51 East Market Street, Akron, Ohio 44308, United States',
  location: { street: '51 East Market Street', city: 'Akron', state: 'Ohio', zip: '44308' },
  url: 'https://link.dice.fm/w6f949243fee',
  external_url: null,
  perm_name: 'angela-perley-sparkle-carcass-with-special-guest-zach-angeloni-23rd-jul-musica-akron-tickets',
  event_images: { landscape: 'https://dice-media.imgix.net/attachments/2026-07-07/8ccfe622.jpg?rect=0%2C351' },
  images: ['https://dice-media.imgix.net/attachments/2026-07-07/8ccfe622.jpg'],
  ticket_types: [{ name: 'General Admission', price: { total: 1200, fees: 150, face_value: 1050 } }],
  price: null,
  sold_out: false,
  flags: ['qr-code', 'cooling-off-period', 'going_ahead'],
  description: 'A night of honky tonk, country, and americana with Angela Perley and band.',
};

// Sells elsewhere: url null, external_url on TicketWeb, price in cents, no description.
const DAVID_NAIL = {
  id: '7336f928e11af023110c7328',
  type: 'linkout',
  name: 'Celebrity Etc presents: David Nail',
  date: '2026-09-18T00:00:00Z',
  date_end: '2026-09-18T03:00:00Z',
  venue: 'Musica',
  venues: [{ id: 11682, name: 'Musica' }],
  address: '51 East Market St, Akron, OH, 44308',
  url: null,
  external_url: 'https://www.ticketweb.com/event/david-nail-down-to-the-musica-tickets/14885743?pl=celebrityakron',
  perm_name: null,
  event_images: { landscape: 'https://s1.ticketm.net/dam/a/b7e/c1366b91.jpg' },
  ticket_types: [],
  price: 3000,
  sold_out: null,
  flags: ['going_ahead'],
  description: '',
};

// A Facebook-pasted link, tracking blob and all.
const RYOT = {
  id: 'ryot',
  type: 'linkout',
  name: 'RYOT TOUR: ICONS',
  date: '2026-09-28T23:00:00Z',
  venue: 'Musica',
  venues: [{ id: 11682, name: 'Musica' }],
  address: '51 East Market St, Akron, OH, 44308',
  url: null,
  external_url: 'https://www.eventbrite.com/e/ryot-tour-icons-tickets-1993533995846?aff=oddtdtcreator&fbclid=PAb21jcATEojRleHRuA2Fs',
  ticket_types: [],
  price: 4400,
  flags: ['going_ahead'],
};

// Cancelled at Mahall's, and a Roxy show that rides along on the Mahall's venue id.
const CANCELLED = {
  id: 'love-island',
  name: 'Love Island watch party',
  date: '2026-07-23T23:00:00Z',
  venue: "Mahall's",
  venues: [{ id: 9821, name: "Mahall's" }],
  flags: ['qr-code', 'cooling-off-period', 'cancelled'],
};
const ROXY_RIDER = {
  id: 'roxy-rider',
  name: "Mahall's Renaissance Market",
  date: '2026-07-25T15:00:00Z',
  venue: "The Roxy at Mahall's",
  venues: [{ id: 10178, name: "The Roxy at Mahall's" }, { id: 9821, name: "Mahall's" }],
  flags: ['going_ahead'],
};

// --- venue isolation -----------------------------------------------------------

t("a Roxy show does not belong to Mahall's just because it names it second", () => {
  assert.strictEqual(belongsTo(ROXY_RIDER, { ids: ['9821'], name: "Mahall's" }), false);
  assert.strictEqual(belongsTo(ROXY_RIDER, { ids: ['10178'], name: "The Roxy at Mahall's" }), true);
  assert.strictEqual(belongsTo(CANCELLED, { ids: ['9821'], name: "Mahall's" }), true);
});

t('a venue held under two DICE ids matches on either', () => {
  // The Foundry is 11725 and 14492 at the same Cleveland address.
  assert.strictEqual(belongsTo(ANGELA, { ids: ['11725', '11682'], name: 'x' }), true);
  assert.strictEqual(belongsTo(ANGELA, { ids: ['11725', '14492'], name: 'x' }), false);
});

t('without an id, the venue name decides, exactly and case-insensitively', () => {
  assert.strictEqual(belongsTo(ROXY_RIDER, { ids: [], name: "the roxy at mahall's" }), true);
  assert.strictEqual(belongsTo(ROXY_RIDER, { ids: [], name: "Mahall's" }), false);
  assert.strictEqual(belongsTo(ANGELA, { ids: [], name: 'Musica' }), true);
});

t('an empty venue never matches everything', () => {
  assert.strictEqual(belongsTo({ venue: '', venues: [] }, { ids: [], name: '' }), false);
  assert.strictEqual(belongsTo(ANGELA, { ids: [], name: '' }), false);
});

t('pinned ids are read off the url without touching the network', async () => {
  assert.deepStrictEqual(
    await resolveVenue({ name: 'The Foundry', url: 'https://dice.fm/venue/the-foundry-ar97?ids=11725,14492' }),
    { ids: ['11725', '14492'], name: 'The Foundry' },
  );
  assert.deepStrictEqual(
    await resolveVenue({ name: 'Musica', url: 'https://dice.fm/?ids=11682' }),
    { ids: ['11682'], name: 'Musica' },
  );
  // No slug and nothing pinned: the name is all there is, and that is allowed.
  assert.deepStrictEqual(
    await resolveVenue({ name: 'The Grog Shop', url: 'https://grogshop.gs/' }),
    { ids: [], name: 'The Grog Shop' },
  );
});

// --- pagination ----------------------------------------------------------------

t('the next cursor is moved onto the host this key is allowed on', () => {
  // Verbatim, links.next answers 403: DICE emits it against events-api.dice.fm
  // while the key only works on partners-endpoint. A venue would have to pass 200
  // upcoming shows to hit it, at which point the whole source would go dark.
  const emitted = 'https://events-api.dice.fm/api/v2/events?filter[venue_ids][]=11682&page[number]=2&page[size]=200&types=linkout%2Cevent';
  const got = nextUrl(emitted);
  assert.ok(got.startsWith('https://partners-endpoint.dice.fm/api/v2/events?'), got);
  assert.ok(got.includes('page%5Bnumber%5D=2') || got.includes('page[number]=2'), got);
  assert.ok(got.includes('11682'), got);
});

t('no next cursor means stop', () => {
  assert.strictEqual(nextUrl(null), null);
  assert.strictEqual(nextUrl(''), null);
  assert.strictEqual(nextUrl('   '), null);
});

// --- the promoter prefix, and why it is stripped -------------------------------

t('a promoter billing is stripped, a real title is not', () => {
  assert.strictEqual(stripPresenter('Celebrity Etc presents: David Nail'), 'David Nail');
  assert.strictEqual(stripPresenter('SUB:MERGED presents: SUMMER RAVE 2026'), 'SUMMER RAVE 2026');
  assert.strictEqual(stripPresenter('Lucero'), 'Lucero');
  // No colon: "presents" is doing ordinary work in the sentence, so leave it.
  assert.strictEqual(stripPresenter('A Band That Presents Nothing'), 'A Band That Presents Nothing');
  // Nothing worth keeping on one side or the other.
  assert.strictEqual(stripPresenter('presents: X'), 'presents: X');
  assert.strictEqual(stripPresenter(''), '');
  assert.strictEqual(stripPresenter(null), '');
});

t('the stripped title is what lets dedupe collapse the ticketing twin', () => {
  const live = (title, start) => ({
    title, start_at: start, venue: 'Musica', city_id: 'akron', host: 'Ticketmaster',
    ticket_url: 'https://www.ticketweb.com/event/x/1',
  });
  const fromDice = (row) => ({
    title: row.summary, start_at: row.start.toISOString(), venue: 'Musica', city_id: 'akron',
    host: 'Musica', ticket_url: row.url,
  });
  const nail = fromDice(toRawEvent(DAVID_NAIL));
  assert.ok(isTicketedTwin(live('David Nail: Down To The Studs', nail.start_at), nail));
  // The regression this guards: with the prefix left on, the extra tokens break
  // the subset test and the reader sees the same show twice.
  assert.ok(!isTicketedTwin(
    live('David Nail: Down To The Studs', nail.start_at),
    { ...nail, title: 'Celebrity Etc presents: David Nail' },
  ));
});

// --- price ---------------------------------------------------------------------

t('ticket_types totals are all-in cents, cheapest first, + when tiers differ', () => {
  assert.strictEqual(priceOf(ANGELA), '$12');
  assert.strictEqual(priceOf({ ticket_types: [{ price: { total: 3502 } }, { price: { total: 10609 } }] }), '$35.02+');
  assert.strictEqual(priceOf({ ticket_types: [{ price: { total: 2000 } }, { price: { total: 2000 } }] }), '$20');
});

t('free means free only when DICE sells the ticket', () => {
  // Its own ticket type, priced at zero: genuinely free.
  assert.strictEqual(priceOf({ ticket_types: [{ price: { total: 0 } }] }), 'Free');
  // A linkout sells elsewhere, so a bare zero is "not stated". Printing Free on a
  // paid show is the error a reader turns up and gets caught by.
  assert.strictEqual(priceOf({ ticket_types: [], price: 0 }), 'See tickets');
  assert.strictEqual(priceOf({ ticket_types: [], price: null }), 'See tickets');
  assert.strictEqual(priceOf({}), 'See tickets');
  assert.strictEqual(priceOf(DAVID_NAIL), '$30');
});

// --- mapping -------------------------------------------------------------------

t('a DICE-sold show maps whole', () => {
  const r = toRawEvent(ANGELA, 'Musica');
  assert.strictEqual(r.summary, 'Angela Perley & Sparkle Carcass with special guest Zach Angeloni');
  assert.strictEqual(r.url, 'https://link.dice.fm/w6f949243fee');
  assert.strictEqual(r.price, '$12');
  assert.strictEqual(r.location, 'Musica, 51 East Market Street, Akron, Ohio 44308, United States');
  assert.strictEqual(r.start.toISOString(), '2026-07-23T23:30:00.000Z');
  assert.strictEqual(r.end.toISOString(), '2026-07-24T03:30:00.000Z');
  assert.ok(r.image.startsWith('https://dice-media.imgix.net/'));
});

t('a linkout falls through to the external ticket page', () => {
  const r = toRawEvent(DAVID_NAIL, 'Musica');
  assert.strictEqual(r.summary, 'David Nail');
  assert.ok(r.url.startsWith('https://www.ticketweb.com/event/david-nail'));
  assert.strictEqual(r.price, '$30');
});

t('click trackers are stripped, the venue\'s own params are kept', () => {
  const r = toRawEvent(RYOT, 'Musica');
  assert.ok(!r.url.includes('fbclid'), r.url);
  assert.ok(r.url.includes('aff=oddtdtcreator'), r.url);
});

t('perm_name is the last resort, and only when there is one', () => {
  const r = toRawEvent({ ...ANGELA, url: null, external_url: null }, 'Musica');
  assert.strictEqual(r.url, `https://dice.fm/event/${ANGELA.perm_name}`);
  assert.strictEqual(toRawEvent({ ...DAVID_NAIL, external_url: null }, 'Musica').url, null);
});

t('cancelled and postponed shows are dropped, rescheduled ones are not', () => {
  assert.strictEqual(toRawEvent(CANCELLED), null);
  assert.strictEqual(toRawEvent({ ...CANCELLED, flags: ['postponed'] }), null);
  assert.ok(toRawEvent({ ...CANCELLED, flags: ['rescheduled'] }));
});

t('sold out is said in the description, never in the title', () => {
  const r = toRawEvent({ ...ANGELA, sold_out: true }, 'Musica');
  // The title feeds source_uid; folding "sold out" in would mint a second row the
  // moment a show sells out, and a third when a release opens it back up.
  assert.strictEqual(r.summary, ANGELA.name);
  assert.ok(r.description.startsWith('Sold out.'));
});

t('a nonsense date is dropped rather than stored as Invalid Date', () => {
  assert.strictEqual(toRawEvent({ ...ANGELA, date: 'not a date' }), null);
  assert.strictEqual(toRawEvent({ ...ANGELA, date: undefined }), null);
  // An end before the start is no end at all.
  assert.strictEqual(toRawEvent({ ...ANGELA, date_end: '2026-07-23T00:00:00Z' }, 'Musica').end, null);
});

t('a row with nothing in it does not throw', () => {
  assert.strictEqual(toRawEvent({}), null);
  const r = toRawEvent({ date: '2026-07-23T23:30:00Z' }, 'Musica');
  assert.strictEqual(r.summary, '');
  assert.strictEqual(r.location, 'Musica');
  assert.strictEqual(r.url, null);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
