// Render-side venue/address dedupe. Aggregated rows (and some older data) can
// carry the SAME string in both venue and address, or one containing the other —
// which printed the address twice on detail screens, in share messages, and in
// calendar exports. These helpers collapse that at render time, so every row in
// the DB displays clean without a backfill.

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// The distinct, ordered parts worth showing. If one part contains the other
// (venue "Sunny Street Cafe" inside address "Sunny Street Cafe, 277 W …"),
// only the longer, more complete one is kept.
export function placeParts(venue, address) {
  const v = String(venue || '').trim();
  const a = String(address || '').trim();
  if (!v) return a ? [a] : [];
  if (!a) return [v];
  const nv = norm(v);
  const na = norm(a);
  if (nv === na || na.includes(nv)) return [a];
  if (nv.includes(na)) return [v];
  return [v, a];
}

// One-line form for share messages and calendar exports: "Venue, Address".
export function placeLine(venue, address) {
  return placeParts(venue, address).join(', ');
}

// Two-line form for detail-screen "Where" fields.
export function placeMultiline(venue, address) {
  return placeParts(venue, address).join('\n');
}

// Feed placeholders that must never become a Follow target or a maps query
// ("Follow Virtual", directions to the literal word "See venue").
export function isPlaceholderVenue(venue) {
  return /^(virtual|online|tbd|tba|see venue)$/i.test(String(venue || '').trim());
}

// Stable identity for follow-matching. Venue strings arrive noisy and get
// reformatted between feed runs ("Sanger - Meeting Room A (Capacity : 50)",
// "Ritter Planetarium, 2855 West Bancroft…"), and exact-string matching both
// fragmented follows across rooms and orphaned every follow when the venue
// backfill cleaned the strings. Compare on the leading place name only.
export function venueCore(venue) {
  return String(venue || '')
    .toLowerCase()
    .split('(')[0]
    .split(',')[0]
    .split(' - ')[0]
    .replace(/[^a-z0-9& ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
