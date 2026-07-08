// BiblioCommons "BiblioEvents" — big-system library calendars ({sub}.bibliocommons.com).
// Public JSON gateway, no key. Verified against plymc (Youngstown & Mahoning County,
// 14 branches) and starklibrary (Stark County / Canton).
//   event_sources row: type 'bibliocommons', url = the site (e.g.
//   https://plymc.bibliocommons.com), city_id = fallback town.
//
// API (live-verified 2026-07): GET
//   https://gateway.bibliocommons.com/v2/libraries/{libraryId}/events/search
//     ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&page=N&limit=50
// MUST be /events/search — the bare /events endpoint ignores the date params.
// Response: events.results = [eventId...], entities.{events,locations,places,images}
// inlined, events.pagination = {pages,...}. Times: definition.start is naive local
// Eastern; indexStart/indexEnd are true UTC — we parse those.
//
// Branch routing: each branch resolves to a street address ("Boardman Library,
// 7680 Glenwood Ave, Youngstown, OH 44512") — the postal city lies for township
// branches, which is exactly what the boundary-polygon pass corrects later. We
// lead the location with the BRANCH NAME so name-routing gets first crack too.

const UA = { 'User-Agent': 'Mozilla/5.0 (LocalLoop aggregator)' };
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const trim = (s) => String(s || '').trim();

function addr(a) {
  if (!a) return '';
  return [trim(a.number) + ' ' + trim(a.street), trim(a.city), trim(a.state) + ' ' + trim(a.zip)]
    .map((p) => p.trim()).filter(Boolean).join(', ');
}

export async function pull(source, { floor, cutoff }) {
  const libraryId = new URL(source.url).hostname.split('.')[0];
  const site = `https://${libraryId}.bibliocommons.com`;
  const base =
    `https://gateway.bibliocommons.com/v2/libraries/${libraryId}/events/search` +
    `?startDate=${day(floor)}&endDate=${day(cutoff)}&limit=50`;

  const out = [];
  for (let page = 1, pages = 1; page <= pages && page <= 40; page++) {
    const res = await fetch(`${base}&page=${page}`, { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    pages = data?.events?.pagination?.pages || 1;
    const ids = data?.events?.results || [];
    const ev = data?.entities?.events || {};
    const locs = data?.entities?.locations || {};
    const places = data?.entities?.places || {};
    const imgs = data?.entities?.images || {};

    for (const id of ids) {
      const e = ev[id];
      const d = e?.definition;
      if (!d || d.isCancelled) continue;

      // True-UTC instants; date-only strings (all-day) get local noon downstream.
      const allDay = !/T/.test(String(d.start || ''));
      const start = new Date(e.indexStart || d.start);
      if (Number.isNaN(start.getTime())) continue;
      const end = e.indexEnd || d.end ? new Date(e.indexEnd || d.end) : null;

      let location = '';
      if (d.branchLocationId && locs[d.branchLocationId]) {
        const b = locs[d.branchLocationId];
        location = `${trim(b.name)}, ${addr(b.address)}`;
      } else if (d.nonBranchLocationId && places[d.nonBranchLocationId]) {
        const p = places[d.nonBranchLocationId];
        location = `${trim(p.name)}, ${addr(p.address) || trim(d.locationDetails)}`;
      } else {
        location = trim(d.locationDetails);
      }

      const img = d.featuredImageId && imgs[d.featuredImageId] ? imgs[d.featuredImageId].url : null;
      out.push({
        summary: trim(d.title),
        description: String(d.description || ''),
        location,
        url: `${site}/events/${id}`,
        image: img,
        start,
        end: end && !Number.isNaN(end.getTime()) ? end : null,
        allDay,
      });
    }
    if (!ids.length) break;
  }
  return out;
}
