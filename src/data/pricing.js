// Reach-based ad pricing. A town's "reach" is its total listing views (a proxy
// for how many locals the app reaches there). As a town grows, its tier — and
// its ad prices — step up. This is what lets you charge more where you have more
// users, and gives advertisers a reason to lock in an early rate.
export const PRICING_TIERS = [
  { name: 'Founding',    minReach: 0,     sponsor: 19, featured7: 9,  featured30: 25 },
  { name: 'Local',       minReach: 1000,  sponsor: 29, featured7: 12, featured30: 35 },
  { name: 'Established', minReach: 5000,  sponsor: 49, featured7: 19, featured30: 49 },
  { name: 'Premier',     minReach: 20000, sponsor: 79, featured7: 29, featured30: 79 },
];

// Map a reach number to its tier + the threshold/name of the next step up.
export function rateForReach(reach = 0) {
  let tier = PRICING_TIERS[0];
  for (const t of PRICING_TIERS) if (reach >= t.minReach) tier = t;
  const idx = PRICING_TIERS.indexOf(tier);
  const next = PRICING_TIERS[idx + 1] || null;
  return {
    ...tier,
    nextTierAt: next ? next.minReach : null,
    nextTierName: next ? next.name : null,
  };
}
