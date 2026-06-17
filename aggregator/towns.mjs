// Assign an event to the town in its location, not the town of whoever hosts it
// (e.g. the Findlay library runs storytimes at its Arlington branch — those
// belong under Arlington). Multi-word names first so "Bowling Green" wins.
const TOWNS = [
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
].map(([id, name]) => [id, new RegExp(`\\b${name}\\b`, 'i')]);

// Return the town id found in `location` (a venue/address string), else fallback.
export function cityFromLocation(location, fallback) {
  const loc = String(location || '');
  for (const [id, re] of TOWNS) {
    if (re.test(loc)) return id;
  }
  return fallback;
}
