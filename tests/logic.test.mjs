// Pure-logic tests for the functions that decide dates, pricing, and grouping.
// Run: node tests/logic.test.mjs
import assert from 'node:assert';
import { calendarBits, daysFromNow, relativeDay, toDateString, dateRangeLabel } from '../src/utils/dates.js';
import { rateForUsers, PRICING_TIERS } from '../src/data/pricing.js';

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
  assert.ok(dateRangeLabel('2026-06-19', '2026-06-20').includes('–'));
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
  assert.equal(rateForUsers(0).nextTierAt, 50);
  assert.equal(rateForUsers(60).name, 'Local');
  assert.equal(rateForUsers(60).sponsor, 29);
  assert.equal(rateForUsers(300).name, 'Established');
  assert.equal(rateForUsers(2000).name, 'Premier');
  assert.equal(rateForUsers(2000).nextTierAt, null);
});
t('pricing tiers monotonically increase', () => {
  for (let i = 1; i < PRICING_TIERS.length; i++) {
    assert.ok(PRICING_TIERS[i].sponsor > PRICING_TIERS[i - 1].sponsor, 'sponsor price increases');
    assert.ok(PRICING_TIERS[i].minUsers > PRICING_TIERS[i - 1].minUsers, 'threshold increases');
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
