// Logo fallback for a paid sponsor slot.
//
// A generic grey storefront glyph on an ad reads as unsold, which is the opposite of
// what the advertiser bought — and plenty of small businesses have no usable logo file
// at all. Coloured initials always look deliberate, so no ad ever looks like a
// placeholder even when nobody sends artwork.
//
// Lives here rather than inside AdBanner so it can be imported and tested by plain
// Node; AdBanner itself pulls in react-native and cannot be.

// From the app's own palette, not random hues, so the feed still looks like the feed.
export const INITIALS_COLORS = ['#15315B', '#1D6F54', '#8A4B12', '#6B2E5F', '#1F5E7A', '#7A3030'];

// Derived from the name, so a business keeps the same colour across sessions, devices
// and every town it runs in. Deterministic, not random: an ad that changed colour on
// each render would look broken.
export function initialsColor(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return INITIALS_COLORS[h % INITIALS_COLORS.length];
}

// Up to two letters from the first two real words. Leading "The"/"A"/"An" is skipped so
// "The Cutting Room" is CR rather than TC, and a single-word name falls back to its
// first two characters ("Blanchards" -> BL).
export function initialsOf(name) {
  const words = String(name || '')
    .replace(/[^A-Za-z0-9 &']/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w, i, a) => !(i === 0 && a.length > 1 && /^(the|a|an)$/i.test(w)));
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
