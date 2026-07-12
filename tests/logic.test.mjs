// Pure-logic tests for the functions that decide dates, pricing, and grouping.
// Run: node tests/logic.test.mjs
import assert from 'node:assert';
import { calendarBits, daysFromNow, relativeDay, toDateString, dateRangeLabel, isOver, isThisWeekend } from '../src/utils/dates.js';
import { rateForUsers, PRICING_TIERS } from '../src/data/pricing.js';
import { effectiveEndMs } from '../src/lib/eventTime.js';

// Mirror of grouping.bucketForDays (can't import it directly — it uses a
// bundler-style extensionless import that native Node won't resolve). Kept in
// sync with src/utils/grouping.js.
const bucketForDays = (d) =>
  d <= 0 ? 'Today' : d === 1 ? 'Tomorrow' : d <= 6 ? 'This Week' : d <= 13 ? 'Next Week' : 'Later';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('  FAIL:', name, '—', e.message); } };

// --- dates: the date-only-string local-midnight fix (was rendering prev day in ET) ---
t('calendarBits parses date-only as local', () => {
  const b = calendarBits('2026-06-20');
  assert.equal(b.day, 20);
  assert.equal(b.month, 'Jun');
  assert.equal(b.weekday, 'SAT'); // 2026-06-20 is a Saturday
});
t('toDateString round-trips local date', () => {
  assert.equal(toDateString('2026-06-20'), '2026-06-20');
});
t('daysFromNow: same day = 0', () => {
  const now = new Date(2026, 5, 15, 23, 0, 0);
  assert.equal(daysFromNow('2026-06-15', now), 0);
});
// --- isOver: hide events once they're finished ---
t('isOver: ended in the past = over', () => {
  const now = new Date(2026, 5, 15, 19, 3); // 7:03pm
  assert.equal(isOver('2026-06-15T10:30:00', '2026-06-15T11:30:00', now), true);
});
t('isOver: ends later today = not over', () => {
  const now = new Date(2026, 5, 15, 19, 3);
  assert.equal(isOver('2026-06-15T19:00:00', '2026-06-15T21:00:00', now), false);
});
t('isOver: no end, started >3h ago = over', () => {
  const now = new Date(2026, 5, 15, 19, 3);
  assert.equal(isOver(new Date(2026, 5, 15, 11, 30), null, now), true);
});
t('isOver: no end, started 1h ago = not over (grace)', () => {
  const now = new Date(2026, 5, 15, 19, 3);
  assert.equal(isOver(new Date(2026, 5, 15, 18, 0), null, now), false);
});
t('isOver: all-day (noon) earlier today = not over', () => {
  const now = new Date(2026, 5, 15, 19, 3);
  assert.equal(isOver(new Date(2026, 5, 15, 12, 0), null, now), false);
});
t('isOver: all-day yesterday = over', () => {
  const now = new Date(2026, 5, 15, 19, 3);
  assert.equal(isOver(new Date(2026, 5, 14, 12, 0), null, now), true);
});

// --- isThisWeekend (2026-06-15 is a Monday; weekend = Fri 19 – Sun 21) ---
t('isThisWeekend: coming Saturday from Monday', () => {
  const mon = new Date(2026, 5, 15, 9, 0);
  assert.equal(isThisWeekend('2026-06-19', mon), true); // Fri
  assert.equal(isThisWeekend('2026-06-21', mon), true); // Sun
});
t('isThisWeekend: weekdays are not weekend', () => {
  const mon = new Date(2026, 5, 15, 9, 0);
  assert.equal(isThisWeekend('2026-06-15', mon), false);
  assert.equal(isThisWeekend('2026-06-17', mon), false);
});
t('isThisWeekend: next weekend excluded', () => {
  const mon = new Date(2026, 5, 15, 9, 0);
  assert.equal(isThisWeekend('2026-06-26', mon), false); // next Friday
});
t('isThisWeekend: on Saturday, includes Sunday', () => {
  const sat = new Date(2026, 5, 20, 14, 0);
  assert.equal(isThisWeekend('2026-06-21', sat), true);
});

t('daysFromNow: future days', () => {
  const now = new Date(2026, 5, 15, 1, 0, 0);
  assert.equal(daysFromNow('2026-06-18', now), 3);
});
t('relativeDay: today/tomorrow', () => {
  const now = new Date(2026, 5, 15, 9, 0, 0);
  assert.equal(relativeDay('2026-06-15', now), 'Today');
  assert.equal(relativeDay('2026-06-16', now), 'Tomorrow');
});
t('dateRangeLabel: single vs range', () => {
  assert.equal(dateRangeLabel('2026-06-20', '2026-06-20'), dateRangeLabel('2026-06-20'));
  assert.ok(dateRangeLabel('2026-06-19', '2026-06-20').includes(' to '));
});

// --- all-day events: the aggregator anchors them to NOON Eastern with no end;
//     effectiveEndMs must keep them visible through the rest of the ET day, not
//     drop them off the feed a few hours in (regression: noon-anchored festivals
//     were vanishing ~2-4pm on the day they happened). ---
t('effectiveEndMs keeps a noon-anchored all-day event through the ET day', () => {
  const noonET = '2026-07-15T16:00:00.000Z'; // noon EDT (UTC-4)
  const end = effectiveEndMs(noonET, null, 'Hancock County Fair', 'family');
  // still current at 6pm ET (22:00Z) the same day
  assert.ok(end >= Date.parse('2026-07-15T22:00:00Z'));
  // ends by midnight ET (04:00Z next day)
  assert.equal(end, Date.parse('2026-07-16T04:00:00Z'));
});
t('effectiveEndMs respects a real end time', () => {
  const end = effectiveEndMs('2026-07-15T23:00:00.000Z', '2026-07-16T01:00:00.000Z', 'Concert', 'music');
  assert.equal(end, Date.parse('2026-07-16T01:00:00Z'));
});

// --- grouping buckets ---
t('bucketForDays thresholds', () => {
  assert.equal(bucketForDays(0), 'Today');
  assert.equal(bucketForDays(-1), 'Today'); // started earlier today
  assert.equal(bucketForDays(1), 'Tomorrow');
  assert.equal(bucketForDays(3), 'This Week');
  assert.equal(bucketForDays(6), 'This Week');
  assert.equal(bucketForDays(8), 'Next Week');
  assert.equal(bucketForDays(13), 'Next Week');
  assert.equal(bucketForDays(20), 'Later');
});

// --- reach-based pricing tiers ---
t('rateForUsers tiers step up by active users', () => {
  assert.equal(rateForUsers(0).name, 'Founding');
  assert.equal(rateForUsers(0).sponsor, 19);
  assert.equal(rateForUsers(0).nextTierAt, 250);
  assert.equal(rateForUsers(300).name, 'Local');
  assert.equal(rateForUsers(300).sponsor, 29);
  assert.equal(rateForUsers(1200).name, 'Established');
  assert.equal(rateForUsers(6000).name, 'Premier');
  assert.equal(rateForUsers(6000).nextTierAt, null);
});
t('pricing tiers monotonically increase', () => {
  for (let i = 1; i < PRICING_TIERS.length; i++) {
    assert.ok(PRICING_TIERS[i].sponsor > PRICING_TIERS[i - 1].sponsor, 'sponsor price increases');
    assert.ok(PRICING_TIERS[i].minUsers > PRICING_TIERS[i - 1].minUsers, 'threshold increases');
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
