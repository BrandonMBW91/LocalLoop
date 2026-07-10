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
  ['sylvania', 'Sylvania'],
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
  ['portage-lakes', 'Portage Lakes'],
  // Portage Lakes is unincorporated and spans New Franklin + Coventry Township.
  // We don't list those separately, so map their place-names to Portage Lakes —
  // that's how the New Franklin / Kiwanis community feeds route here instead of
  // being dropped as "out of area" (their addresses say "New Franklin, OH").
  ['portage-lakes', 'New Franklin'],
  ['portage-lakes', 'Coventry Township'],
  ['hartville', 'Hartville'],
  ['alliance', 'Alliance'],
  // --- 2026 expansion ---
  // NW corner (Defiance anchor)
  ['fremont', 'Fremont'],
  ['wapakoneta', 'Wapakoneta'],
  ['defiance', 'Defiance'],
  ['napoleon', 'Napoleon'],
  ['bryan', 'Bryan'],
  ['wauseon', 'Wauseon'],
  // Central + Miami Valley (Piqua/Troy + Greenville + Marion/Delaware anchors)
  ['marysville', 'Marysville'],
  ['marion', 'Marion'],
  ['delaware', 'Delaware'],
  ['troy', 'Troy'],
  ['piqua', 'Piqua'],
  ['sidney', 'Sidney'],
  ['greenville', 'Greenville'],
  ['versailles', 'Versailles'],
  // North-central (Mansfield anchor)
  ['mansfield', 'Mansfield'],
  ['ontario', 'Ontario'],
  ['ashland', 'Ashland'],
  ['bucyrus', 'Bucyrus'],
  ['galion', 'Galion'],
  ['willard', 'Willard'],
  // NE densify (inside Akron / Canton anchors)
  ['medina', 'Medina'],
  ['ravenna', 'Ravenna'],
  ['streetsboro', 'Streetsboro'],
  ['orrville', 'Orrville'],
  ['dover', 'Dover'],
  ['new-philadelphia', 'New Philadelphia'],
  ['port-clinton', "Port Clinton"],
  ['catawba-island', "Catawba Island"],
  ['put-in-bay', "Put-in-Bay"],
  ['kelleys-island', "Kelleys Island"],
  ['youngstown', "Youngstown"],
  ['warren', "Warren"],
  ['boardman', "Boardman"],
  ['austintown', "Austintown"],
  ['niles', "Niles"],
  ['girard', "Girard"],
  ['struthers', "Struthers"],
  ['canfield', "Canfield"],
  ['salem', "Salem"],
  ['columbiana', "Columbiana"],
  ['wooster', "Wooster"],
  ['norwalk', "Norwalk"],
  ['lakeview', "Lakeview"],
  ['russells-point', "Russells Point"],
  ['st-marys', "St. Marys"],
  ['celina', "Celina"],
  ['zanesville', "Zanesville"],
  ['cambridge', "Cambridge"],
  ['coshocton', "Coshocton"],
  ['marietta', "Marietta"],
  ['belpre', "Belpre"],
  ['athens', "Athens"],
  ['nelsonville', "Nelsonville"],
  ['logan', "Logan"],
  ['new-lexington', "New Lexington"],
  ['chillicothe', "Chillicothe"],
  ['waverly', "Waverly"],
  ['portsmouth', "Portsmouth"],
  ['ironton', "Ironton"],
  ['jackson', "Jackson"],
  ['wellston', "Wellston"],
  ['mcarthur', "McArthur"],
  ['gallipolis', "Gallipolis"],
  ['pomeroy', "Pomeroy"],
  ['st-clairsville', "St. Clairsville"],
  ['steubenville', "Steubenville"],
  ['cadiz', "Cadiz"],
  ['woodsfield', "Woodsfield"],
  ['caldwell', "Caldwell"],
  ['mcconnelsville', "McConnelsville"],
  ['springfield', "Springfield"],
  ['urbana', "Urbana"],
  ['washington-court-house', "Washington Court House"],
  ['hillsboro', "Hillsboro"],
  ['greenfield', "Greenfield"],
  ['wilmington', "Wilmington"],
  ['eaton', "Eaton"],
  ['georgetown', "Georgetown"],
  ['ripley', "Ripley"],
  ['west-union', "West Union"],
  ['peebles', "Peebles"],
];

const STREET = '(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|way|ct|court|pl|place|cir|circle|pike|hwy|highway|trail|ter|terrace|pkwy|parkway|sq|square)';
// Words after a town name that mean it ISN'T that town: "Sandusky County" is
// Fremont's county, "Sandusky River/Bay" are features, "Arlington Heights" is
// elsewhere. (Deliberately NOT blocking "Township" — Perrysburg Township etc.
// are that town's community.)
const NOT_TOWN = '(?:county|heights|river|bay)';
// "Upper Sandusky" is a different town entirely — never match the bare name there.
const NOT_BEFORE = '(?<!\\bupper\\s)';

// Pass 1: town immediately before OH / Ohio / an OHIO ZIP (43xxx-45xxx). The ZIP
// branch is Ohio-only so "Marion 46952" (Marion, Indiana's ZIP) can't match.
const CITY_POS = NAMES.map(([id, name]) => [id, new RegExp(`${NOT_BEFORE}\\b${name}\\b,?\\s*(?:oh\\b|ohio\\b|4[3-5]\\d{3}\\b)`, 'i')]);
// Pass 2: any town mention that isn't the start of a street name — including
// two-town road names ("Waterville Monclova Rd") — or a county/feature name.
const ANY = NAMES.map(([id, name]) => [id, new RegExp(`${NOT_BEFORE}\\b${name}\\b(?!\\s+${STREET}\\b|\\s+\\w+\\s+${STREET}\\b|\\s+${NOT_TOWN}\\b)`, 'i')]);
// The address clearly names an Ohio city ("…, OH 43452" / "…, Ohio, …").
const NAMES_A_CITY = /,\s*(?:oh|ohio)\b|\b(?:oh|ohio)\s+\d{5}\b/i;

// Out-of-area guard. Many Ohio towns share their name with a city in another
// state (Marion IN, Troy MI, Dover DE/NH, Delaware DE, Ontario CANADA, Bryan TX)
// — the bare-name Pass 2 would otherwise force those out-of-state events into the
// Ohio town. If the address carries a NON-Ohio state code / spelled-out state /
// country and NO Ohio marker at all, it's out of area → return null up front.
const NON_OH_STATE = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);
const OH_MARKER = /,\s*oh\b|\bohio\b|\b4[3-5]\d{3}\b/i;
function outOfArea(loc) {
  if (OH_MARKER.test(loc)) return false; // any Ohio marker wins
  for (const m of loc.matchAll(/,\s*([A-Za-z]{2})\b/g)) {
    if (NON_OH_STATE.has(m[1].toUpperCase())) return true;
  }
  // Spelled-out states/country that don't collide with any Ohio town name.
  return /\b(?:canada|michigan|indiana|kentucky|pennsylvania|illinois|wisconsin|minnesota|new york)\b/i.test(loc);
}

// Returns the town id for an event's location. Falls back to `fallback` (the
// feed's town) only when the address has no recognizable city. Returns null when
// the address names an Ohio city that ISN'T one of our towns (out of area —
// e.g. a Visit Toledo event in Cleveland), so the caller can drop it.
export function cityFromLocation(location, fallback) {
  const loc = String(location || '');
  // Portage Lakes is an unincorporated lake community that shares Akron's postal
  // city + ZIP (addresses often read "...Portage Lakes Drive, Akron, OH 44319"),
  // so a NAMED "Portage Lakes" venue/place must win over the "Akron, OH" city
  // slot below. A bare "Portage Lakes <street>" alone is just a road, not a place.
  if (/\bportage lakes\b(?!\s+(?:dr|drive|blvd|boulevard|rd|road|ave|avenue|pkwy|parkway|ln|lane|ct|court)\b)/i.test(loc)) return 'portage-lakes';
  if (outOfArea(loc)) return null; // out-of-state city sharing an Ohio town's name → drop
  for (const [id, re] of CITY_POS) if (re.test(loc)) return id;
  for (const [id, re] of ANY) if (re.test(loc)) return id;
  if (NAMES_A_CITY.test(loc)) return null; // out-of-area city → exclude
  return fallback;
}
