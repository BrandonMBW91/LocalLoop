// #2 Near me — use device location to suggest the closest served town at first
// launch (and offer a "use my location" shortcut in the picker). Loaded through a
// guarded require, like expo-store-review, so an OTA update running on an older
// binary without the native module degrades to "unavailable" instead of crashing.
import { CITY_COORDS } from '../data/city-coords';
import { CITIES } from '../data/cities';

let Location = null;
try { Location = require('expo-location'); } catch { Location = null; }

export const nearMeAvailable = () => Boolean(Location?.requestForegroundPermissionsAsync);

const CITY_NAME = Object.fromEntries(CITIES.map((c) => [c.id, c.name]));

const milesBetween = (lat1, lng1, lat2, lng2) => {
  const R = 3958.8, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

// Nearest served town to a coordinate, with distance. Null if nothing is within
// maxMiles (user is outside Ohio coverage — don't suggest a random town).
export function nearestTownTo(lat, lng, maxMiles = 40) {
  let best = null;
  for (const [id, [tLat, tLng]] of Object.entries(CITY_COORDS)) {
    const miles = milesBetween(lat, lng, tLat, tLng);
    if (miles <= maxMiles && (!best || miles < best.miles)) best = { cityId: id, miles };
  }
  return best ? { ...best, cityName: CITY_NAME[best.cityId] || best.cityId } : null;
}

// Prompt for location (once) and resolve the nearest town. Returns:
//   { cityId, cityName, miles }  on success
//   null  if unavailable / denied / no fix / outside coverage — caller falls
//         back to the manual picker, never blocked.
export async function suggestTownFromLocation() {
  try {
    if (!nearMeAvailable()) return null;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getLastKnownPositionAsync() ||
                await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy?.Low ?? 1 });
    const { latitude, longitude } = pos?.coords || {};
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    return nearestTownTo(latitude, longitude);
  } catch {
    return null;
  }
}
