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

export const SEED_FOOD_TRUCKS = [
  {
    id: 'ft-001',
    cityId: 'findlay',
    name: 'Flag City Tacos',
    cuisine: 'Tacos',
    date: '2026-06-18',
    startTime: '11:00 AM',
    endTime: '2:00 PM',
    locationName: 'Marathon Petroleum HQ Lot',
    address: '539 S Main St, Findlay, OH',
    featured: true,
    host: 'Flag City Tacos',
    note: 'Street tacos, burritos, and fresh-made guac. Lunch rush — order ahead by phone to skip the line.',
  },
  {
    id: 'ft-002',
    cityId: 'findlay',
    name: "Smokin' Hancock BBQ",
    cuisine: 'BBQ',
    date: '2026-06-19',
    startTime: '5:00 PM',
    endTime: '8:00 PM',
    locationName: 'Riverside Park',
    address: '231 McManness Ave, Findlay, OH',
    host: "Smokin' Hancock BBQ",
    note: 'Slow-smoked brisket, pulled pork, and ribs. Parked by the amphitheater before the summer concert.',
  },
  {
    id: 'ft-003',
    cityId: 'findlay',
    name: 'The Rolling Scoop',
    cuisine: 'Ice Cream',
    date: '2026-06-20',
    startTime: '1:00 PM',
    endTime: '6:00 PM',
    locationName: 'Dorney Plaza',
    address: '318 Dorney Plaza, Findlay, OH',
    host: 'The Rolling Scoop',
    note: 'Hand-dipped cones, sundaes, and dairy-free options. Find us downtown all afternoon.',
  },
  {
    id: 'ft-004',
    cityId: 'findlay',
    name: 'Bean There Coffee Truck',
    cuisine: 'Coffee',
    date: '2026-06-17',
    startTime: '7:00 AM',
    endTime: '11:00 AM',
    locationName: 'Findlay Village Mall',
    address: '1800 Tiffin Ave, Findlay, OH',
    host: 'Bean There',
    note: 'Espresso, cold brew, and fresh muffins to start your morning.',
  },
  {
    id: 'ft-005',
    cityId: 'findlay',
    name: 'Buckeye Burgers',
    cuisine: 'Burgers',
    date: '2026-06-21',
    startTime: '11:30 AM',
    endTime: '2:30 PM',
    locationName: 'Emory Adams Park',
    address: '1212 Lima Ave, Findlay, OH',
    host: 'Buckeye Burgers',
    note: 'Smash burgers, hand-cut fries, and milkshakes. Cash and cards welcome.',
  },
  {
    id: 'ft-006',
    cityId: 'findlay',
    name: 'Pho Sho',
    cuisine: 'Asian',
    date: '2026-06-22',
    startTime: '5:00 PM',
    endTime: '8:00 PM',
    locationName: 'University of Findlay — Main Lot',
    address: '1000 N Main St, Findlay, OH',
    host: 'Pho Sho',
    note: 'Vietnamese pho, banh mi, and spring rolls. Vegetarian options available.',
  },

  // Second city, to show multi-city works for trucks too.
  {
    id: 'ft-tif-001',
    cityId: 'tiffin',
    name: 'Seneca Street Eats',
    cuisine: 'Sandwiches',
    date: '2026-06-20',
    startTime: '11:00 AM',
    endTime: '2:00 PM',
    locationName: 'Downtown Tiffin',
    address: 'S Washington St, Tiffin, OH',
    host: 'Seneca Street Eats',
    note: 'Gourmet grilled cheese and soups. Parked near the courthouse.',
  },
];

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
