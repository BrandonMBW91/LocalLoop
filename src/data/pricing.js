// Ad pricing based on a town's ACTUAL monthly active users. The more locals use
// Local Loop in a town, the more an ad there is worth — so the price tier steps
// up with real usage, and early advertisers can lock in a low founding rate.
export const PRICING_TIERS = [
  { name: 'Founding',    minUsers: 0,    sponsor: 19, featured7: 9,  featured30: 25 },
  { name: 'Local',       minUsers: 50,   sponsor: 29, featured7: 12, featured30: 35 },
  { name: 'Established', minUsers: 250,  sponsor: 49, featured7: 19, featured30: 49 },
  { name: 'Premier',     minUsers: 1000, sponsor: 79, featured7: 29, featured30: 79 },
];

// Map a monthly-active-user count to its tier + the next step up.
export function rateForUsers(users = 0) {
  let tier = PRICING_TIERS[0];
  for (const t of PRICING_TIERS) if (users >= t.minUsers) tier = t;
  const idx = PRICING_TIERS.indexOf(tier);
  const next = PRICING_TIERS[idx + 1] || null;
  return {
    ...tier,
    nextTierAt: next ? next.minUsers : null,
    nextTierName: next ? next.name : null,
  };
}
