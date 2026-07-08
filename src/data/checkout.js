// Single source of truth for the LIVE Stripe Payment Links. Imported by BOTH the
// app (app/promote.js) and the web advertise-page generator
// (aggregator/generate-advertise.mjs) so the two can never drift apart.
//
// The tiers listed here are TAP-TO-BUY. Any higher tier (Established / Premier)
// intentionally has no link and falls back to the email flow — see the note atop
// src/data/pricing.js. To add or re-threshold a tier: create its Stripe Payment
// Link and add it here (town + featured30), and it becomes buyable everywhere.
export const REGION_LINK = 'https://buy.stripe.com/cNi8wQ5P94cqf8WaIL4Vy01'; // All-Region $79/mo flat

export const CHECKOUT_BY_TIER = {
  Founding: {
    town: 'https://buy.stripe.com/aFa9AU0uPaAO2ma18b4Vy00', // $19/mo
    featured30: 'https://buy.stripe.com/00w4gA6TddN0bWK9EH4Vy02', // $25
  },
  Local: {
    town: 'https://buy.stripe.com/9B65kE1yT24i6CqbMP4Vy03', // $29/mo
    featured30: 'https://buy.stripe.com/7sY28s91l8sG1i6bMP4Vy04', // $35
  },
};
