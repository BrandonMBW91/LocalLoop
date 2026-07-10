// Metro ad bundles — a mid-tier ad SKU between a single town ($19) and All-Region
// ($79). A "metro" is a curated cluster of adjacent catalog towns that a regional
// business recognizes as its service area (e.g. "the Akron area"). One purchase
// runs the ad in every town in the cluster.
//
// Every id below MUST exist in src/data/cities.js (validated by check-cities /
// the bundle test). The Stripe metro dropdown values are the KEYS here.
// NOTE: this map is also copied into supabase/functions/stripe-webhook/index.ts
// (edge functions can't import app src) — keep the two in sync when editing.
export const METRO_BUNDLES = {
  toledo:       { name: 'Greater Toledo',        towns: ['toledo', 'perrysburg', 'sylvania', 'bowling-green', 'waterville'] },
  akron:        { name: 'Akron Metro',           towns: ['akron', 'cuyahoga-falls', 'kent', 'stow', 'hudson', 'tallmadge', 'barberton', 'wadsworth', 'medina', 'ravenna', 'streetsboro', 'portage-lakes'] },
  canton:       { name: 'Canton–Massillon',  towns: ['canton', 'massillon', 'north-canton', 'hartville', 'alliance', 'orrville', 'dover', 'new-philadelphia'] },
  youngstown:   { name: 'Youngstown–Warren', towns: ['youngstown', 'warren', 'boardman', 'austintown', 'niles', 'girard', 'struthers', 'canfield', 'salem', 'columbiana'] },
  findlaylima:  { name: 'Findlay–Lima',       towns: ['findlay', 'fostoria', 'tiffin', 'fremont', 'bluffton', 'ada', 'lima', 'wapakoneta', 'van-wert', 'upper-sandusky', 'north-baltimore', 'carey'] },
  mansfield:    { name: 'Mansfield–North Central', towns: ['mansfield', 'ontario', 'ashland', 'bucyrus', 'galion', 'willard', 'marion', 'delaware'] },
};

// Flat price points (not MAU-tiered — bundles sell on reach, not one town's usage).
export const BUNDLE_PRICING = {
  metro:      { monthly: 39, annual: 390 },  // annual = 2 months free
  allRegion:  { monthly: 79, annual: 790 },
  townAnnual: 190,                            // Founding town, annual
};

export const metroLabel = (code) => METRO_BUNDLES[code]?.name || code;
export const metroTowns = (code) => METRO_BUNDLES[code]?.towns || [];
