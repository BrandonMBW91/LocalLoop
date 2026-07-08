// Ad pricing based on a town's ACTUAL monthly active users. The more locals use
// Local Loop in a town, the more an ad there is worth — so the price tier steps
// up with real usage, and early advertisers can lock in a low founding rate.
//
// TAP-TO-BUY vs EMAIL: only Founding and Local have live Stripe payment links, so
// only those two are tap-to-buy in the app + website. Established/Premier fall
// back to an email quote on purpose (a big-town ad is worth a conversation and we
// never want to auto-undercharge). If you ADD or RE-THRESHOLD a tier here, create
// its Stripe payment link and add it to BOTH app/promote.js (CHECKOUT_BY_TIER)
// and aggregator/generate-advertise.mjs (LINKS) — otherwise it silently email-
// falls-back and no one can buy it in-app.
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
