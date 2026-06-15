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

export const SEED_GARAGE_SALES = [
  {
    id: 'gs-001',
    cityId: 'findlay',
    title: 'Big Multi-Family Garage Sale',
    type: 'Multi-Family Sale',
    start: '2026-06-19',
    end: '2026-06-20',
    dailyStart: '8:00 AM',
    dailyEnd: '3:00 PM',
    address: '1224 Western Ave, Findlay, OH',
    neighborhood: 'Western Avenue',
    items: ['Furniture', 'Kids & Baby', 'Toys', 'Household'],
    host: 'The Miller Family',
    note: 'Early birds welcome. Cash only. Three families combining — lots of kids’ items and a like-new sofa.',
  },
  {
    id: 'gs-002',
    cityId: 'findlay',
    title: 'Estate Sale — Everything Priced to Sell',
    type: 'Estate Sale',
    start: '2026-06-20',
    end: '2026-06-20',
    dailyStart: '9:00 AM',
    dailyEnd: '2:00 PM',
    address: '512 Country Club Dr, Findlay, OH',
    neighborhood: 'Country Club',
    items: ['Antiques', 'Furniture', 'Jewelry', 'Household'],
    featured: true,
    host: 'Hancock Estate Services',
    note: 'Antique dining set, vintage glassware, costume jewelry, and quality furniture. Numbers handed out at 8:30 AM.',
  },
  {
    id: 'gs-003',
    cityId: 'findlay',
    title: 'Moving Sale — Must Go This Weekend!',
    type: 'Moving Sale',
    start: '2026-06-26',
    end: '2026-06-28',
    dailyStart: '8:00 AM',
    dailyEnd: '5:00 PM',
    address: '845 Larkins St, Findlay, OH',
    neighborhood: 'Larkins Street',
    items: ['Furniture', 'Electronics', 'Tools', 'Garden'],
    host: 'The Reyes Family',
    note: 'Relocating out of state — everything must go. TV, power tools, patio set, washer & dryer. Make an offer!',
  },
  {
    id: 'gs-004',
    cityId: 'findlay',
    title: 'Church Rummage & Bake Sale',
    type: 'Rummage Sale',
    start: '2026-06-20',
    end: '2026-06-20',
    dailyStart: '8:00 AM',
    dailyEnd: '1:00 PM',
    address: '201 W Sandusky St, Findlay, OH',
    neighborhood: 'Downtown',
    items: ['Clothing', 'Books', 'Household', 'Toys'],
    host: 'First Presbyterian Church',
    note: 'Fill-a-bag for $5 in the last hour. Homemade baked goods, gently used clothing, books, and housewares.',
  },
  {
    id: 'gs-005',
    cityId: 'findlay',
    title: 'Whole-Street Neighborhood Sale',
    type: 'Yard Sale',
    start: '2026-06-27',
    end: '2026-06-27',
    dailyStart: '8:00 AM',
    dailyEnd: '2:00 PM',
    address: 'Bright Rd & Sunset Dr, Findlay, OH',
    neighborhood: 'Bright Road',
    items: ['Furniture', 'Clothing', 'Toys', 'Sporting Goods', 'Garden'],
    host: 'Bright Road Neighbors',
    note: 'Over a dozen homes participating up and down the street. Maps available at the corner. Something for everyone!',
  },
  {
    id: 'gs-006',
    cityId: 'findlay',
    title: 'Garage & Tool Cleanout',
    type: 'Garage Sale',
    start: '2026-06-21',
    end: '2026-06-21',
    dailyStart: '7:30 AM',
    dailyEnd: '12:00 PM',
    address: '418 Lincoln St, Findlay, OH',
    neighborhood: 'Lincoln Street',
    items: ['Tools', 'Sporting Goods', 'Electronics'],
    host: 'Dave K.',
    note: 'Hand tools, power tools, fishing gear, and golf clubs. No early birds please.',
  },

  // Second city, to prove garage sales are multi-city too.
  {
    id: 'gs-tif-001',
    cityId: 'tiffin',
    title: 'Front Yard Sale',
    type: 'Yard Sale',
    start: '2026-06-20',
    end: '2026-06-21',
    dailyStart: '9:00 AM',
    dailyEnd: '4:00 PM',
    address: '233 Miami St, Tiffin, OH',
    neighborhood: 'Miami Street',
    items: ['Clothing', 'Books', 'Household'],
    host: 'The Johnson Family',
    note: 'Lots of women’s clothing, paperbacks, and kitchen items.',
  },
];

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
