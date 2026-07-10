// Post-time town check: geocode a typed address and find which served town it
// actually sits in, so a stop posted "in Findlay" with a North Baltimore address
// can be routed to (or confirmed for) the right town. Fail-open by design —
// any error, missing token, or low-confidence result returns null and the post
// proceeds exactly as the user chose.
import { CITIES } from '../data/cities';
import { CITY_COORDS } from '../data/city-coords';

const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
const CITY_NAME = Object.fromEntries(CITIES.map((c) => [c.id, c.name]));

const milesBetween = (lat1, lng1, lat2, lng2) => {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

// Nearest served town to a point, or null if nothing is within `maxMiles`
// (address outside our coverage — nothing sensible to suggest).
export function nearestTown(lat, lng, maxMiles = 8) {
  let best = null;
  for (const [id, [tLat, tLng]] of Object.entries(CITY_COORDS)) {
    const miles = milesBetween(lat, lng, tLat, tLng);
    if (miles <= maxMiles && (!best || miles < best.miles)) best = { cityId: id, miles };
  }
  return best ? { ...best, cityName: CITY_NAME[best.cityId] || best.cityId } : null;
}

// Geocode the address (biased near the currently selected town) and return
// { cityId, cityName, miles } for the served town it belongs to, or null when
// unknown. Only trusts precise result types — a bare town name or POI guess
// shouldn't override the poster's choice.
export async function townFromAddress(address, nearCityId) {
  try {
    if (!TOKEN || !address || address.trim().length < 8) return null;
    const prox = CITY_COORDS[nearCityId];
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address.trim())}.json` +
      `?access_token=${TOKEN}&country=US&limit=1&types=address,poi` +
      (prox ? `&proximity=${prox[1]},${prox[0]}` : '');
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const f = json?.features?.[0];
    if (!f || (f.relevance ?? 0) < 0.75) return null;
    const [lng, lat] = f.center || [];
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return nearestTown(lat, lng);
  } catch {
    return null; // network flake etc. — never block a post over the check
  }
}
