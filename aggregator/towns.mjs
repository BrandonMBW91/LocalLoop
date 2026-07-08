// Assign an event to the town in its location, not the town of whoever hosts it
// (e.g. the Findlay library runs storytimes at its Arlington branch → Arlington).
// Two guards against false matches:
//   1) Prefer the town in the "city position" — right before OH/Ohio/a ZIP —
//      so "Findlay Street, Carey, OH" resolves to Carey, not Findlay.
//   2) Otherwise, ignore a town name that's part of a STREET name
//      ("Findlay Street", "Findlay Ave", etc.).
// Exported so check-cities.mjs can verify every picker city has a matcher here.
export const NAMES = [
  ['upper-sandusky', 'Upper Sandusky'],
  ['north-baltimore', 'North Baltimore'],
  ['bowling-green', 'Bowling Green'],
  ['van-wert', 'Van Wert'],
  ['bellefontaine', 'Bellefontaine'],
  ['perrysburg', 'Perrysburg'],
  ['waterville', 'Waterville'],
  ['sandusky', 'Sandusky'],
  ['fostoria', 'Fostoria'],
  ['bluffton', 'Bluffton'],
  ['arlington', 'Arlington'],
  ['leipsic', 'Leipsic'],
  ['pandora', 'Pandora'],
  ['findlay', 'Findlay'],
  ['toledo', 'Toledo'],
  ['tiffin', 'Tiffin'],
  ['carey', 'Carey'],
  ['lima', 'Lima'],
  ['ada', 'Ada'],
  ['kenton', 'Kenton'],
  ['richwood', 'Richwood'],
  ['larue', 'LaRue'],
  ['prospect', 'Prospect'],
  ['green-camp', 'Green Camp'],
  // Northeast Ohio (Akron / Canton). "North Canton" before "Canton" so it wins;
  // "Green" is intentionally omitted (too generic — collides with Bowling Green / Green Camp).
  ['north-canton', 'North Canton'],
  ['cuyahoga-falls', 'Cuyahoga Falls'],
  ['akron', 'Akron'],
  ['canton', 'Canton'],
  ['massillon', 'Massillon'],
  ['kent', 'Kent'],
  ['stow', 'Stow'],
  ['hudson', 'Hudson'],
  ['barberton', 'Barberton'],
  ['tallmadge', 'Tallmadge'],
  ['wadsworth', 'Wadsworth'],
  ['hartville', 'Hartville'],
  ['alliance', 'Alliance'],
];

const STREET = '(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|way|ct|court|pl|place|cir|circle|pike|hwy|highway|trail|ter|terrace|pkwy|parkway|sq|square)';
// Words after a town name that mean it ISN'T that town: "Sandusky County" is
// Fremont's county, "Sandusky River/Bay" are features, "Arlington Heights" is
// elsewhere. (Deliberately NOT blocking "Township" — Perrysburg Township etc.
// are that town's community.)
const NOT_TOWN = '(?:county|heights|river|bay)';
// "Upper Sandusky" is a different town entirely — never match the bare name there.
const NOT_BEFORE = '(?<!\\bupper\\s)';

// Pass 1: town immediately before OH / Ohio / a 5-digit ZIP (the city slot).
const CITY_POS = NAMES.map(([id, name]) => [id, new RegExp(`${NOT_BEFORE}\\b${name}\\b,?\\s*(?:oh\\b|ohio\\b|\\d{5}\\b)`, 'i')]);
// Pass 2: any town mention that isn't the start of a street name — including
// two-town road names ("Waterville Monclova Rd") — or a county/feature name.
const ANY = NAMES.map(([id, name]) => [id, new RegExp(`${NOT_BEFORE}\\b${name}\\b(?!\\s+${STREET}\\b|\\s+\\w+\\s+${STREET}\\b|\\s+${NOT_TOWN}\\b)`, 'i')]);
// The address clearly names an Ohio city ("…, OH 43452" / "…, Ohio, …").
const NAMES_A_CITY = /,\s*(?:oh|ohio)\b|\b(?:oh|ohio)\s+\d{5}\b/i;

// Returns the town id for an event's location. Falls back to `fallback` (the
// feed's town) only when the address has no recognizable city. Returns null when
// the address names an Ohio city that ISN'T one of our towns (out of area —
// e.g. a Visit Toledo event in Catawba Island), so the caller can drop it.
export function cityFromLocation(location, fallback) {
  const loc = String(location || '');
  for (const [id, re] of CITY_POS) if (re.test(loc)) return id;
  for (const [id, re] of ANY) if (re.test(loc)) return id;
  if (NAMES_A_CITY.test(loc)) return null; // out-of-area city → exclude
  return fallback;
}
