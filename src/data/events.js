// Sample seed events for the prototype. In production these come from a
// backend (curated + approved submissions + aggregated feeds). Dates are
// kept in the near future relative to launch so the list looks alive.

export const CATEGORIES = [
  'Music',
  'Family',
  'Food',
  'Sports',
  'Arts',
  'Community',
  'Market',
  'Education',
];

export const SEED_EVENTS = [
  {
    id: 'fdl-001',
    cityId: 'findlay',
    title: 'Riverside Park Summer Concert',
    category: 'Music',
    emoji: '🎶',
    start: '2026-06-19T19:00:00',
    end: '2026-06-19T21:00:00',
    venue: 'Riverside Park Amphitheater',
    address: '231 McManness Ave, Findlay, OH',
    price: 'Free',
    host: 'Findlay Parks & Recreation',
    featured: true,
    description:
      'Bring a lawn chair or blanket and enjoy a free evening of live music by the river. Local food trucks on site. Family friendly and open to all ages.',
  },
  {
    id: 'fdl-002',
    cityId: 'findlay',
    title: 'Downtown Findlay Farmers Market',
    category: 'Market',
    emoji: '🥕',
    start: '2026-06-20T09:00:00',
    end: '2026-06-20T13:00:00',
    venue: 'Saturday Market on Main',
    address: 'S Main St, Downtown Findlay, OH',
    price: 'Free entry',
    host: 'Findlay Downtown Business Association',
    featured: true,
    description:
      'Fresh local produce, baked goods, handmade crafts, and flowers from Hancock County growers and makers. Every Saturday morning through October.',
  },
  {
    id: 'fdl-003',
    cityId: 'findlay',
    title: 'Family Story Time at the Library',
    category: 'Family',
    emoji: '📚',
    start: '2026-06-17T10:30:00',
    end: '2026-06-17T11:15:00',
    venue: 'Findlay-Hancock County Public Library',
    address: '206 Broadway St, Findlay, OH',
    price: 'Free',
    host: 'Findlay-Hancock County Public Library',
    featured: false,
    description:
      'A gentle morning of stories, songs, and rhymes for young children and their grown-ups. No registration needed.',
  },
  {
    id: 'fdl-004',
    cityId: 'findlay',
    title: 'Marathon Center: An Evening of Jazz',
    category: 'Arts',
    emoji: '🎷',
    start: '2026-06-21T19:30:00',
    end: '2026-06-21T21:30:00',
    venue: 'Marathon Center for the Performing Arts',
    address: '200 W Main Cross St, Findlay, OH',
    price: '$25 - $40',
    host: 'Marathon Center for the Performing Arts',
    featured: true,
    description:
      'An intimate evening of classic and contemporary jazz in Findlay’s premier performance hall. Reserved seating; doors open 30 minutes early.',
  },
  {
    id: 'fdl-005',
    cityId: 'findlay',
    title: 'Hancock County Fair Kickoff',
    category: 'Community',
    emoji: '🎡',
    start: '2026-06-27T10:00:00',
    end: '2026-06-27T22:00:00',
    venue: 'Hancock County Fairgrounds',
    address: '1017 E Sandusky St, Findlay, OH',
    price: '$8 / kids under 5 free',
    host: 'Hancock County Agricultural Society',
    featured: false,
    description:
      'Rides, livestock shows, fair food, and live entertainment kick off the annual county fair. Fun for the whole family.',
  },
  {
    id: 'fdl-006',
    cityId: 'findlay',
    title: 'Dietsch Brothers Ice Cream Social',
    category: 'Food',
    emoji: '🍦',
    start: '2026-06-22T15:00:00',
    end: '2026-06-22T18:00:00',
    venue: 'Dietsch Brothers Fine Chocolates & Ice Cream',
    address: '400 W Main Cross St, Findlay, OH',
    price: 'Pay per item',
    host: 'Dietsch Brothers',
    featured: false,
    description:
      'A Findlay tradition since 1937. Stop in for hand-dipped ice cream and homemade chocolates on a summer afternoon.',
  },
  {
    id: 'fdl-007',
    cityId: 'findlay',
    title: 'Flag City Balloon Fest Planning Walk',
    category: 'Community',
    emoji: '🎈',
    start: '2026-06-24T18:00:00',
    end: '2026-06-24T19:30:00',
    venue: 'Emory Adams Park',
    address: '1212 Lima Ave, Findlay, OH',
    price: 'Free',
    host: 'Flag City Balloon Fest Committee',
    featured: false,
    description:
      'Volunteers and curious neighbors welcome. Learn how the annual hot air balloon festival comes together and how you can help.',
  },
  {
    id: 'fdl-008',
    cityId: 'findlay',
    title: 'Pickleball Open Play',
    category: 'Sports',
    emoji: '🏓',
    start: '2026-06-18T08:00:00',
    end: '2026-06-18T10:00:00',
    venue: 'Riverbend Recreation Area',
    address: '16618 Township Rd 208, Findlay, OH',
    price: '$3 drop-in',
    host: 'Findlay Pickleball Club',
    featured: false,
    description:
      'All skill levels welcome, including beginners. Paddles available to borrow. A friendly, social morning of pickleball.',
  },
  {
    id: 'fdl-009',
    cityId: 'findlay',
    title: 'Beginner Smartphone Help Session',
    category: 'Education',
    emoji: '📱',
    start: '2026-06-23T13:00:00',
    end: '2026-06-23T14:30:00',
    venue: 'Findlay-Hancock County Public Library',
    address: '206 Broadway St, Findlay, OH',
    price: 'Free',
    host: 'Library Tech Help Desk',
    featured: false,
    description:
      'Friendly one-on-one help with your phone or tablet. Learn texting, photos, video calls, and apps at your own pace. No question is too small.',
  },
  {
    id: 'fdl-010',
    cityId: 'findlay',
    title: 'Sunrise Yoga in the Park',
    category: 'Sports',
    emoji: '🧘',
    start: '2026-06-21T07:30:00',
    end: '2026-06-21T08:30:00',
    venue: 'Riverside Park',
    address: '231 McManness Ave, Findlay, OH',
    price: '$5 suggested',
    host: 'Findlay Community Yoga',
    featured: false,
    description:
      'Gentle, all-levels outdoor yoga to start your weekend. Bring your own mat. Modifications offered for every pose.',
  },
  {
    id: 'fdl-011',
    cityId: 'findlay',
    title: 'Historic Downtown Walking Tour',
    category: 'Education',
    emoji: '🏛️',
    start: '2026-06-26T17:30:00',
    end: '2026-06-26T19:00:00',
    venue: 'Hancock Historical Museum',
    address: '422 W Sandusky St, Findlay, OH',
    price: '$10',
    host: 'Hancock Historical Museum',
    featured: false,
    description:
      'A guided stroll through Findlay’s historic downtown with stories of the oil boom era and the city’s architecture.',
  },
  {
    id: 'fdl-012',
    cityId: 'findlay',
    title: 'Food Truck Friday',
    category: 'Food',
    emoji: '🌮',
    start: '2026-06-26T11:00:00',
    end: '2026-06-26T14:00:00',
    venue: 'Dorney Plaza / City Building',
    address: '318 Dorney Plaza, Findlay, OH',
    price: 'Pay per item',
    host: 'Downtown Findlay Inc.',
    featured: false,
    description:
      'A rotating lineup of local food trucks serving lunch downtown. A great midday break with plenty of seating.',
  },

  // A couple of seed events for a second city to prove multi-city works.
  {
    id: 'tif-001',
    cityId: 'tiffin',
    title: 'Tiffin Art Walk',
    category: 'Arts',
    emoji: '🎨',
    start: '2026-06-20T17:00:00',
    end: '2026-06-20T20:00:00',
    venue: 'Downtown Tiffin',
    address: 'S Washington St, Tiffin, OH',
    price: 'Free',
    host: 'Tiffin Art Guild',
    featured: true,
    description:
      'Galleries, pop-up artists, and live music fill downtown Tiffin for a relaxed evening art walk.',
  },
  {
    id: 'bg-001',
    cityId: 'bowling-green',
    title: 'BG Summer Farmers Market',
    category: 'Market',
    emoji: '🍅',
    start: '2026-06-17T08:00:00',
    end: '2026-06-17T12:00:00',
    venue: 'Wood County Courthouse Square',
    address: '1 Courthouse Sq, Bowling Green, OH',
    price: 'Free entry',
    host: 'BG Farmers Market',
    featured: true,
    description:
      'Wednesday morning market with local produce, meats, honey, and handmade goods on the courthouse lawn.',
  },
];

// Merge seed + user-submitted, filter to a city, sort by start date ascending.
export function getEventsForCity(cityId, submittedEvents = [], now = new Date()) {
  const cutoff = now.getTime() - 12 * 60 * 60 * 1000; // keep today's earlier events
  return [...SEED_EVENTS, ...submittedEvents]
    .filter((e) => e.cityId === cityId)
    .filter((e) => new Date(e.start).getTime() >= cutoff)
    .sort((a, b) => {
      // Featured (paid/promoted) listings rise to the top.
      if (!!b.featured !== !!a.featured) return b.featured ? 1 : -1;
      return new Date(a.start) - new Date(b.start);
    });
}

export function getEventById(id, submittedEvents = []) {
  return [...SEED_EVENTS, ...submittedEvents].find((e) => e.id === id) || null;
}
