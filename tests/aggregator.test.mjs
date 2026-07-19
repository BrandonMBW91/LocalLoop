// Unit tests for the aggregator's title quality gate. Run: node tests/aggregator.test.mjs
//
// Every case below is a REAL title that was in the live database on 2026-07-19, not a
// made-up example. The filters were previously validated by hand against production
// data and that validation lived nowhere, so a later tweak to one regex could silently
// re-flood a town or start eating real events. This file is that validation, frozen.
//
// The two KEEP cases marked "caught in review" are false positives an earlier draft of
// WORSHIP_RE actually produced. They are the reason the "of a/an/the" guard exists.
import assert from 'node:assert';
import { titleRejectReason } from '../aggregator/aggregate.mjs';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('  FAIL:', name, '\n         ', e.message); } };

// --- titles that MUST be dropped, and why -------------------------------------
// [title, expected reason]
const DROP = [
  // Standing shop hours posted as events. 77 real rows, all from Carey's Basilica.
  ['Gift Shop Open (10am-4:30pm)', 'standing-hours'],
  ['Gift Shop Open (10am-2pm)', 'standing-hours'],

  // Routine worship services. 248 real rows; "Mass (OSC)" alone was 124 of them and
  // buried a town of 3,700 people.
  ['Mass (OSC)', 'worship-service'],
  ['Sunday Mass (UB)', 'worship-service'],
  ['Novena Mass (UB)', 'worship-service'],
  ['Chaldean Mass (UB)', 'worship-service'],
  ['Confessions (LB)', 'worship-service'],
  ['Confessions (Lower Basilica)', 'worship-service'],
  ['Rosary before the Shrine Altar (UB)', 'worship-service'],
  ['Eucharistic Adoration (OSC)', 'worship-service'],
  ['Shrine Devotions (UB)', 'worship-service'],
  ['Full Shrine Devotions (UB)', 'worship-service'],
  ['Worship Service - Non-Denominational', 'worship-service'],

  // Routine government meetings. All 14 of North Canton's "upcoming events" were these.
  ['City Council Meeting', 'gov-meeting'],
  ['Committee of the Whole Meeting', 'gov-meeting'],
  ['Committee of the Whole & City Council Meeting', 'gov-meeting'],
  ['Tree Commission Meeting August', 'gov-meeting'],
  ['Records Commission Meeting - September', 'gov-meeting'],

  // Municipal closure notices (Waterville posted its whole holiday calendar).
  ['City office closed - Labor Day', 'junk'],
  ['City office closed - Thanksgiving', 'junk'],

  // NWS alerts ride in on community iCal feeds (Bluffton Icon) as fake events.
  ['Extreme Heat Warning', 'weather-alert'],
  ['Winter Storm Watch', 'weather-alert'],
  ['Flood Advisory', 'weather-alert'],
];

for (const [title, reason] of DROP) {
  t(`drops "${title}" as ${reason}`, () => {
    assert.strictEqual(titleRejectReason(title), reason);
  });
}

// --- titles that MUST survive --------------------------------------------------
const KEEP = [
  // Both of these were REAL false positives caught while dry-testing the filter
  // against all 29k live events. "Confessions of a Baseball Scout" is a talk;
  // "Mass of the Holy Spirit" is Walsh University's annual convocation.
  'Confessions of a Baseball Scout',
  'Mass of the Holy Spirit',

  // The OUTING_RE rescue: these name a service but are plainly an outing. The
  // candlelight procession is the Basilica's marquee annual pilgrimage event —
  // dropping it would have been the single worst miss of the whole filter.
  'Candlelight Procession & Vigil Mass (SP)',
  'Novena Children\'s Choir Rehearsal (OSC)',
  'Parish Festival Dinner',

  // Real Basilica events that survived and SHOULD have.
  'Bingo (SC)',
  'History Talk & Tour (UB)',

  // "Open" words that must never hit HOURS_RE: it requires an explicit time RANGE.
  'Open House',
  'Open Mic Night',
  'Opening Day',
  'Open Gym',

  // "Massillon" must not trip the \bmass\b word boundary.
  'Massillon Tigers Football',
  'Massillon Public Library Book Sale',

  // Ordinary local events from towns that gained coverage today.
  'Lake Anna Concert Series',
  'Kids Swim & Pizza Party',
  'Kindergarten Bootcamp',
  'Summer Crawl',
  'Friday Summer Concert Series',
  'Zen Coloring',
];

for (const title of KEEP) {
  t(`keeps "${title}"`, () => {
    const r = titleRejectReason(title);
    assert.strictEqual(r, null, `was dropped as "${r}"`);
  });
}

// --- the WORSHIP/OUTING interaction, stated explicitly --------------------------
t('a service word alone drops, but the same word in an outing survives', () => {
  assert.strictEqual(titleRejectReason('Mass'), 'worship-service');
  assert.strictEqual(titleRejectReason('Mass Choir Concert'), null);
  assert.strictEqual(titleRejectReason('Adoration'), 'worship-service');
  assert.strictEqual(titleRejectReason('Adoration Pancake Breakfast'), null);
});

// --- the Carey scenario, as a whole -------------------------------------------
// The regression this file exists to prevent: one high-frequency source drowning a
// small town. Carey went 595 -> 271 events; these are the shapes that decided it.
t('the Carey mix keeps community events and drops the repetition', () => {
  const careyDay = [
    'Mass (OSC)', 'Gift Shop Open (10am-4:30pm)', 'Confessions (LB)', 'Shrine Devotions (UB)',
    'Bingo (SC)', 'History Talk & Tour (UB)', 'Kids Swim & Pizza Party',
  ];
  const kept = careyDay.filter((x) => titleRejectReason(x) === null);
  assert.deepStrictEqual(kept, ['Bingo (SC)', 'History Talk & Tour (UB)', 'Kids Swim & Pizza Party']);
});

// --- defensive ------------------------------------------------------------------
t('handles empty and missing titles without throwing', () => {
  assert.strictEqual(titleRejectReason(''), null);
  assert.strictEqual(titleRejectReason(null), null);
  assert.strictEqual(titleRejectReason(undefined), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
