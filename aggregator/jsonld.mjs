// Generic schema.org Event extractor. Many modern event pages (WordPress "The
// Events Calendar", Squarespace, Wix, venue sites) embed event data as JSON-LD
// in the HTML — the same structured data search engines read. This pulls those
// out so we can aggregate sites that don't expose an iCal feed.

// Find every <script type="application/ld+json"> block and collect Event nodes
// (handles arrays, @graph, and nested types). Returns objects shaped like the
// iCal events makeRow() already understands: { summary, start, end, location, description }.
export function extractJsonLdEvents(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let json;
    try {
      json = JSON.parse(m[1].trim());
    } catch {
      continue; // malformed block — skip
    }
    collect(json, out);
  }
  // De-dupe within the page by title+start (some themes emit an event twice).
  const seen = new Set();
  return out.filter((e) => {
    const k = `${e.summary}|${e.start && e.start.toISOString()}`;
    return seen.has(k) ? false : seen.add(k);
  });
}

function collect(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out));
    return;
  }
  if (node['@graph']) collect(node['@graph'], out);
  const t = node['@type'];
  const types = Array.isArray(t) ? t : [t];
  if (types.some((x) => /(^|[^a-z])Event$/i.test(String(x || '')))) {
    const ev = normalize(node);
    if (ev) out.push(ev);
  }
}

function locString(loc) {
  if (!loc) return '';
  if (typeof loc === 'string') return loc;
  if (Array.isArray(loc)) return locString(loc[0]);
  const name = typeof loc.name === 'string' ? loc.name : '';
  const a = loc.address;
  let addr = '';
  if (typeof a === 'string') addr = a;
  else if (a && typeof a === 'object') {
    addr = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
      .filter(Boolean).join(', ');
  }
  if (!addr) return name;
  if (!name) return addr;
  // Avoid duplication when the name already contains the address (or vice versa).
  const nl = name.toLowerCase(), al = addr.toLowerCase();
  if (nl.includes(al)) return name;
  if (al.includes(nl)) return addr;
  return `${name}, ${addr}`;
}

function cleanDesc(d) {
  if (typeof d !== 'string') return '';
  return d.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalize(node) {
  const name = typeof node.name === 'string' ? node.name
    : Array.isArray(node.name) ? node.name[0] : '';
  const startRaw = node.startDate;
  if (!name || !startRaw) return null;
  const start = new Date(startRaw);
  if (isNaN(start)) return null;
  const end = node.endDate ? new Date(node.endDate) : null;
  return {
    summary: String(name),
    start,
    end: end && !isNaN(end) ? end : null,
    location: locString(node.location),
    description: cleanDesc(node.description),
    url: typeof node.url === 'string' ? node.url : '',
    allDay: /^\d{4}-\d{2}-\d{2}$/.test(String(startRaw)), // date-only = all-day
  };
}
