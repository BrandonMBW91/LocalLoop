// Garage sale listings. Separate from events because they browse differently:
// address-first, often multi-day, with item categories and "this weekend" focus.

export const SALE_ITEMS = [
  'Furniture',
  'Clothing',
  'Kids & Baby',
  'Toys',
  'Tools',
  'Electronics',
  'Antiques',
  'Household',
  'Sporting Goods',
  'Books',
  'Garden',
  'Jewelry',
];

export const SALE_TYPES = [
  'Garage Sale',
  'Yard Sale',
  'Estate Sale',
  'Moving Sale',
  'Multi-Family Sale',
  'Rummage Sale',
];

// Empty in production — garage sales come from real user submissions.
export const SEED_GARAGE_SALES = [];

// Days from `now` until a sale's LAST day (so ongoing/today sales stay visible).
function daysUntilEnd(sale, now) {
  // Fall back to start when end is missing, so a no-end-date sale isn't hidden.
  const end = new Date((sale.end || sale.start) + 'T23:59:59');
  return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
}

export function getGarageSalesForCity(cityId, submitted = [], now = new Date()) {
  return [...SEED_GARAGE_SALES, ...submitted]
    .filter((s) => s.cityId === cityId)
    .filter((s) => daysUntilEnd(s, now) >= 0) // hide sales that already ended
    .sort((a, b) => {
      if (!!b.featured !== !!a.featured) return b.featured ? 1 : -1;
      return new Date(a.start) - new Date(b.start);
    });
}

export function getGarageSaleById(id, submitted = []) {
  return [...SEED_GARAGE_SALES, ...submitted].find((s) => s.id === id) || null;
}

// "This weekend" = starts within the next 7 days (good enough, weekend-heavy data).
export function isUpcomingSoon(sale, now = new Date()) {
  const start = new Date(sale.start + 'T00:00:00');
  const diffDays = Math.ceil((start - now) / (1000 * 60 * 60 * 24));
  return diffDays <= 7 || daysUntilEnd(sale, now) >= 0 && start <= now;
}
