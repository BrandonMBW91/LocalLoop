// Turn a raw iCal location into a consistent { venue, address } pair so the same
// place always shows the same way. The problem: some feeds put a friendly name
// in the location ("Toledo Museum of Art"), some put a bare street address
// ("206 Broadway Findlay OH 45840"), and some leave it blank — which made one
// library show up as both its name AND its street address.

function clean(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deriveVenue(rawLocation, sourceName) {
  const loc = clean(rawLocation).slice(0, 200);
  const src = clean(sourceName);

  // No location given → the source org IS the venue.
  if (!loc) return { venue: src, address: '' };

  // Starts with a street number → it's a bare street address (e.g.
  // "206 Broadway Findlay OH…"), so show the org name as the venue and keep the
  // street as the address. This is what made one library show up two ways.
  if (/^\d/.test(loc)) return { venue: src || loc, address: loc };

  // Otherwise the location already leads with a place name ("Toledo Museum of
  // Art", "Physical Sciences Building, Room 112") — keep it verbatim as the
  // venue. (No clever splitting: that mangled room/suite numbers.)
  return { venue: loc, address: loc };
}
