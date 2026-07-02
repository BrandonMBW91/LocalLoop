// Assign an event to the town in its location, not the town of whoever hosts it
// (e.g. the Findlay library runs storytimes at its Arlington branch → Arlington).
// Two guards against false matches:
//   1) Prefer the town in the "city position" — right before OH/Ohio/a ZIP —
//      so "Findlay Street, Carey, OH" resolves to Carey, not Findlay.
//   2) Otherwise, ignore a town name that's part of a STREET name
//      ("Findlay Street", "Findlay Ave", etc.).
const NAMES = [
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
];

const STREET = '(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|way|ct|court|pl|place|cir|circle|pike|hwy|highway|trail|ter|terrace|pkwy|parkway|sq|square)';

// Pass 1: town immediately before OH / Ohio / a 5-digit ZIP (the city slot).
const CITY_POS = NAMES.map(([id, name]) => [id, new RegExp(`\\b${name}\\b,?\\s*(?:oh\\b|ohio\\b|\\d{5}\\b)`, 'i')]);
// Pass 2: any town mention that isn't the start of a street name.
const ANY = NAMES.map(([id, name]) => [id, new RegExp(`\\b${name}\\b(?!\\s+${STREET}\\b)`, 'i')]);
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
