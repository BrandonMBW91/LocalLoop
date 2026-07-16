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
  { name: 'Tiffin / Seneca', city: 'tiffin', lat: 41.115, lng: -83.178, radius: 24 },
  { name: 'Newark / Licking', city: 'newark', lat: 40.0581, lng: -82.4013, radius: 18 },   // Newark, Heath, Granville
  { name: 'New Albany', city: 'new-albany', lat: 40.0812, lng: -82.8088, radius: 8 },      // tight: Columbus is 12mi west   // Tiffin, Fostoria, Carey, Upper Sandusky
  { name: 'Sandusky / Erie', city: 'sandusky', lat: 41.449, lng: -82.708, radius: 26 },
  { name: 'Bellefontaine / Logan', city: 'bellefontaine', lat: 40.361, lng: -83.760, radius: 30 }, // Bellefontaine, Kenton, Richwood, LaRue, Prospect
  // --- Northeast Ohio ---
  { name: 'Akron metro', city: 'akron', lat: 41.081, lng: -81.519, radius: 26 },       // Akron, Cuyahoga Falls, Stow, Hudson, Tallmadge, Barberton, Kent, Wadsworth
  { name: 'Canton metro', city: 'canton', lat: 40.799, lng: -81.378, radius: 26 },      // Canton, Massillon, North Canton, Hartville, Alliance
  // Medina, Ravenna, Streetsboro (Akron) + Orrville, Dover, New Philadelphia (Canton)
  // are inside the two metros above — no new anchor needed.
  // --- 2026 expansion (new anchors) ---
  { name: 'Mansfield / Richland', city: 'mansfield', lat: 40.759, lng: -82.515, radius: 28 }, // Mansfield, Ontario, Ashland, Bucyrus, Galion, Willard
  { name: 'Marion / Delaware', city: 'marion', lat: 40.440, lng: -83.100, radius: 22 },       // Marion, Delaware
  { name: 'Miami Valley / Piqua-Troy', city: 'troy', lat: 40.100, lng: -84.220, radius: 22 }, // Sidney, Piqua, Troy, Versailles
  { name: 'Greenville / Darke', city: 'greenville', lat: 40.100, lng: -84.630, radius: 20 },
  { name: 'Defiance / NW corner', city: 'defiance', lat: 41.400, lng: -84.280, radius: 30 },   // Defiance, Napoleon, Bryan, Wauseon (Fremont=Sandusky, Wapakoneta=Lima)
  { name: 'Youngstown / Mahoning Valley', city: 'youngstown', lat: 41.100, lng: -80.700, radius: 25 }, // Youngstown, Warren, Boardman, Austintown, Niles, Girard, Struthers, Canfield, Salem, Columbiana
  { name: 'Wooster / Wayne', city: 'wooster', lat: 40.805, lng: -81.935, radius: 18 }, // Wooster; Wayne CVB feed routes county-wide
  // --- Southeast Ohio (2026 statewide phase 1) ---
  { name: 'Zanesville / Cambridge', city: 'zanesville', lat: 39.990, lng: -81.800, radius: 25 }, // Zanesville, Cambridge, Coshocton, New Lexington edge
  { name: 'Marietta / Mid-Ohio Valley', city: 'marietta', lat: 39.415, lng: -81.455, radius: 20 }, // Marietta, Belpre (Parkersburg WV events dropped by router)
  { name: 'Athens / Hocking Hills', city: 'athens', lat: 39.420, lng: -82.250, radius: 25 },       // Athens, Nelsonville, Logan, New Lexington
  { name: 'Chillicothe / Ross', city: 'chillicothe', lat: 39.333, lng: -82.982, radius: 20 },      // Chillicothe, Waverly
  { name: 'Portsmouth / Scioto', city: 'portsmouth', lat: 38.732, lng: -82.998, radius: 20 },      // Portsmouth, Ironton edge
  { name: 'Jackson / Vinton', city: 'jackson', lat: 39.052, lng: -82.637, radius: 18 },            // Jackson, Wellston, McArthur
  { name: 'Gallipolis / Ohio River', city: 'gallipolis', lat: 38.810, lng: -82.202, radius: 18 },  // Gallipolis, Pomeroy
  { name: 'Belmont / Ohio Valley', city: 'st-clairsville', lat: 40.081, lng: -80.900, radius: 20 },// St. Clairsville, Cadiz, Martins Ferry (Wheeling WV dropped by router)
  { name: 'Steubenville / Jefferson', city: 'steubenville', lat: 40.370, lng: -80.634, radius: 15 }, // Steubenville (kept tight to exclude Pittsburgh)
  // --- Southwest Ohio (2026 statewide phase 2) ---
  { name: 'Springfield / Clark', city: 'springfield', lat: 39.924, lng: -83.809, radius: 18 }, // Springfield, Urbana (r kept tight to exclude Dayton)
  { name: 'Washington Court House', city: 'washington-court-house', lat: 39.536, lng: -83.439, radius: 15 },
  { name: 'Hillsboro / Highland', city: 'hillsboro', lat: 39.202, lng: -83.612, radius: 18 }, // Hillsboro, Greenfield
  { name: 'Wilmington / Clinton', city: 'wilmington', lat: 39.445, lng: -83.828, radius: 15 },
  { name: 'Eaton / Preble', city: 'eaton', lat: 39.744, lng: -84.637, radius: 12 }, // tight: Dayton 24mi E, Richmond IN 18mi W
  { name: 'Brown / Adams', city: 'georgetown', lat: 38.870, lng: -83.680, radius: 18 }, // Georgetown, Ripley, West Union, Peebles
  // Dayton ring towns (cores excluded): Beavercreek/Xenia + Wright State's Nutter
  // Center. r=12 keeps it off Dayton city; core-Dayton venues drop via the town
  // matcher (no served town to route to).
  { name: 'Dayton Ring / Greene', city: 'beavercreek', lat: 39.720, lng: -84.010, radius: 12 },
  // --- 2026 statewide phase 3 (final gap counties) ---
  { name: 'Ashtabula / Grand River Valley', city: 'ashtabula', lat: 41.865, lng: -80.790, radius: 20 }, // Ashtabula, Geneva(-on-the-Lake), Conneaut (Erie PA outside)
  { name: 'Millersburg / Amish Country', city: 'millersburg', lat: 40.554, lng: -81.918, radius: 15 },  // Millersburg + unincorporated Berlin/Walnut Creek route here
  { name: 'Mount Vernon / Knox', city: 'mount-vernon', lat: 40.393, lng: -82.486, radius: 15 },          // Mount Vernon, Fredericktown
  // --- Big-3 metros (2026 expansion) ---
  { name: 'Columbus metro', city: 'columbus', lat: 39.961, lng: -82.999, radius: 28 },   // Columbus + Dublin, Westerville, Hilliard, Grove City, Gahanna (Delaware edge overlaps Marion, deduped by source_uid)
  { name: 'Cleveland metro', city: 'cleveland', lat: 41.499, lng: -81.694, radius: 24 }, // Cleveland + inner ring (Lakewood, Parma); Lake Erie to the N, Akron ~30mi S stays outside
  { name: 'Cincinnati metro', city: 'cincinnati', lat: 39.103, lng: -84.512, radius: 24 }, // Cincinnati + Norwood, Blue Ash, Mason edge; KY/IN cross-border venues dropped by the town router
];

// Great-circle miles between two points (haversine).
export function milesBetween(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Which existing anchor (if any) already covers a point — i.e. a new town there
// gets Ticketmaster/SeatGeek events for FREE. Returns { anchor, miles } for the
// nearest covering anchor, or null when the point is outside every anchor (a new
// anchor is needed). Used by scaffold-city.mjs so adding a town no longer needs
// hand-done lat/lng math.
export function anchorFor(lat, lng) {
  let best = null;
  for (const a of ANCHORS) {
    const miles = milesBetween(lat, lng, a.lat, a.lng);
    if (miles <= a.radius && (!best || miles < best.miles)) best = { anchor: a, miles };
  }
  return best;
}

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
