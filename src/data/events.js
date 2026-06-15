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

// Empty in production — all events come from the live backend (feeds + admin +
// approved submissions). Kept as an array so the helpers below stay valid.
export const SEED_EVENTS = [];

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
