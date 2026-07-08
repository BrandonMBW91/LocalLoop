// Geo anchors for the location-based APIs (Ticketmaster, SeatGeek). Instead of
// querying each city by name, we query a handful of metro centers by lat/long +
// radius. cityFromLocation() then reassigns each event to the specific town (and
// drops out-of-area ones). Adding a city inside an existing metro needs NO change
// here — it's auto-covered. A brand-new region is one new anchor.
// `city` = the fallback town id when an event's address names no recognizable town.
export const ANCHORS = [
  // --- Northwest & Central Ohio ---
  { name: 'Toledo metro', city: 'toledo', lat: 41.664, lng: -83.555, radius: 30 },      // Toledo, Perrysburg, Waterville, Bowling Green, Maumee
  { name: 'Findlay / Hancock', city: 'findlay', lat: 41.044, lng: -83.650, radius: 26 }, // Findlay, Fostoria, Arlington, N. Baltimore, Carey, Bluffton, Ada
  { name: 'Lima / Allen', city: 'lima', lat: 40.743, lng: -84.105, radius: 28 },      // Lima, Bluffton, Ada
  { name: 'Van Wert', city: 'van-wert', lat: 40.869, lng: -84.585, radius: 20 },
  { name: 'Tiffin / Seneca', city: 'tiffin', lat: 41.115, lng: -83.178, radius: 24 },   // Tiffin, Fostoria, Carey, Upper Sandusky
  { name: 'Sandusky / Erie', city: 'sandusky', lat: 41.449, lng: -82.708, radius: 26 },
  { name: 'Bellefontaine / Logan', city: 'bellefontaine', lat: 40.361, lng: -83.760, radius: 30 }, // Bellefontaine, Kenton, Richwood, LaRue, Prospect
  // --- Northeast Ohio ---
  { name: 'Akron metro', city: 'akron', lat: 41.081, lng: -81.519, radius: 26 },       // Akron, Cuyahoga Falls, Stow, Hudson, Tallmadge, Barberton, Kent, Wadsworth
  { name: 'Canton metro', city: 'canton', lat: 40.799, lng: -81.378, radius: 26 },      // Canton, Massillon, North Canton, Hartville, Alliance
  // Medina, Ravenna, Streetsboro (Akron) + Orrville, Dover, New Philadelphia (Canton)
  // are inside the two metros above — no new anchor needed.
  // --- 2026 expansion (new anchors) ---
  { name: 'Mansfield / Richland', city: 'mansfield', lat: 40.759, lng: -82.515, radius: 28 }, // Mansfield, Ontario, Ashland, Bucyrus, Galion, Shelby, Willard
  { name: 'Marion / Delaware', city: 'marion', lat: 40.440, lng: -83.100, radius: 22 },       // Marion, Delaware
  { name: 'Miami Valley / Piqua-Troy', city: 'troy', lat: 40.100, lng: -84.220, radius: 22 }, // Sidney, Piqua, Troy, Versailles
  { name: 'Greenville / Darke', city: 'greenville', lat: 40.100, lng: -84.630, radius: 20 },
  { name: 'Defiance / NW corner', city: 'defiance', lat: 41.400, lng: -84.280, radius: 30 },   // Defiance, Napoleon, Bryan, Wauseon (Fremont=Sandusky, Wapakoneta=Lima)
];

// Geohash encoder — Ticketmaster's geoPoint filter wants a geohash, not raw lat/long.
const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
export function geohash(lat, lng, precision = 7) {
  let idx = 0, bit = 0, evenBit = true, hash = '';
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) { idx = idx * 2 + 1; lngMin = mid; } else { idx *= 2; lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { idx = idx * 2 + 1; latMin = mid; } else { idx *= 2; latMax = mid; }
    }
    evenBit = !evenBit;
    if (++bit === 5) { hash += B32[idx]; bit = 0; idx = 0; }
  }
  return hash;
}
