// Food truck "stops" — a truck posting where it'll be and when. Browsed by
// "who's out today / this week" and by cuisine. Date-only + daily time window.

import { daysFromNow } from '../utils/dates';

export const CUISINES = [
  'Tacos',
  'BBQ',
  'Burgers',
  'Pizza',
  'Asian',
  'Coffee',
  'Ice Cream',
  'Breakfast',
  'Seafood',
  'Desserts',
  'Sandwiches',
  'Other',
];

export const CUISINE_EMOJI = {
  Tacos: '🌮',
  BBQ: '🍖',
  Burgers: '🍔',
  Pizza: '🍕',
  Asian: '🥡',
  Coffee: '☕',
  'Ice Cream': '🍦',
  Breakfast: '🍳',
  Seafood: '🦐',
  Desserts: '🍩',
  Sandwiches: '🥪',
  Other: '🍴',
};

// Empty in production — food truck stops come from real user submissions.
export const SEED_FOOD_TRUCKS = [];

// Parse "11:00 AM" to minutes-since-midnight for sorting within a day.
function timeToMinutes(t) {
  if (!t) return 0;
  const m = t.trim().match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
  if (!m) return 0;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

export function getFoodTrucksForCity(cityId, submitted = []) {
  return [...SEED_FOOD_TRUCKS, ...submitted]
    .filter((t) => t.cityId === cityId)
    .filter((t) => daysFromNow(t.date) >= 0) // hide past stops
    .sort((a, b) => {
      if (!!b.featured !== !!a.featured) return b.featured ? 1 : -1;
      const d = new Date(a.date + 'T00:00:00') - new Date(b.date + 'T00:00:00');
      if (d !== 0) return d;
      return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    });
}

export function getFoodTruckById(id, submitted = []) {
  return [...SEED_FOOD_TRUCKS, ...submitted].find((t) => t.id === id) || null;
}
