// Shared outreach ordering: interleave pending drafts across towns by a static
// priority weight (a blend of population and current user count — see
// town-priority.mjs). One lead per town per pass, towns visited high-weight
// first, so each daily batch spans many towns (new markets get coverage) while
// still concentrating on the towns that matter most (audience + size). As a
// town's leads drain, the next town down the list rotates into its slot.
//
// orderPending(pending, { townOf, weightOf }) -> ordered array
//   pending  : [{ to, ... }]         drafts still eligible to send
//   townOf   : (email) => townName   (defaults to 'Findlay')
//   weightOf : (townName) => number  priority weight; unknown town -> 0

export function orderPending(pending, { townOf, weightOf }) {
  // group by town
  const byTown = new Map();
  for (const d of pending) {
    const t = townOf(d.to) || 'Findlay';
    if (!byTown.has(t)) byTown.set(t, []);
    byTown.get(t).push(d);
  }
  // towns in priority order (weight desc, then name for stable ties)
  const towns = [...byTown.keys()].sort((a, b) => (weightOf(b) - weightOf(a)) || a.localeCompare(b));
  // round-robin: one per town per pass, high-weight town first
  const out = [];
  let took = true;
  while (took) {
    took = false;
    for (const t of towns) {
      const list = byTown.get(t);
      if (list && list.length) { out.push(list.shift()); took = true; }
    }
  }
  return out;
}
