// Build-time SEO generator. Runs inside build-web.mjs after the app export +
// static merge. Fetches upcoming events from Supabase (anon, public data) and writes:
//   - dist/e/<id>.html : one indexable landing page per event, with schema.org
//     Event structured data (Google event rich results) and a link into the app.
//   - dist/sitemap.xml : homepage + every town page + every event page.
// Best-effort: if Supabase creds are missing or the fetch fails, it logs and ships
// the app + town pages anyway, so a web build never breaks over SEO extras.

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SITE = 'https://localloop.io';
const HORIZON_DAYS = 60;   // how far ahead to generate event pages
const MAX_PAGES = 4000;    // cap the deploy size; soonest events win

export function loadEnv() {
  try {
    for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env — rely on ambient env */ }
}

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clean = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// ET formatting + the aggregator's all-day anchors (noon ET no-end / midnight ET
// spanning its day). Anchors say "All day"; multi-day events show their span —
// matching the app, so a Google result never disagrees with the screen.
const ET = 'America/New_York';
const etFmt = (iso, opts) => new Date(iso).toLocaleString('en-US', { timeZone: ET, ...opts });
const etHM = (iso) => etFmt(iso, { hour: 'numeric', minute: '2-digit', hour12: true });
function isAllDay(ev) {
  const hm = etHM(ev.start_at);
  if (hm === '12:00 PM' && !ev.end_at) return true;
  if (hm !== '12:00 AM') return false;
  if (!ev.end_at) return true;
  const span = new Date(ev.end_at) - new Date(ev.start_at);
  return span >= 23.5 * 3600e3 && span <= 24.5 * 3600e3;
}
function whenText(ev) {
  const day = etFmt(ev.start_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const allDay = isAllDay(ev);
  const sameDay = !ev.end_at
    || etFmt(ev.start_at, { dateStyle: 'short' }) === etFmt(ev.end_at, { dateStyle: 'short' });
  if (sameDay) return allDay ? `${day} · All day` : `${day} · ${etHM(ev.start_at).replace(':00 ', ' ')} ET`;
  const endDay = etFmt(ev.end_at, { month: 'long', day: 'numeric' });
  return `${day} through ${endDay}${allDay ? '' : ` · ${etHM(ev.start_at).replace(':00 ', ' ')} ET`}`;
}

// venue/address dedupe (mirrors src/utils/place.js): most aggregated rows once
// carried the identical string in both fields; keep the more complete one.
const normPlace = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function placeParts(venue, address) {
  const v = clean(venue); const a = clean(address);
  if (!v) return a ? [a] : [];
  if (!a) return [v];
  const nv = normPlace(v); const na = normPlace(a);
  if (nv === na || na.includes(nv)) return [a];
  if (nv.includes(na)) return [v];
  return [v, a];
}

export async function buildSeo(OUT) {
  loadEnv();
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const townDir = path.join(OUT, 'events');
  const townFiles = fs.existsSync(townDir) ? fs.readdirSync(townDir).filter((f) => f.endsWith('.html')) : [];

  let cityName = {};
  try {
    const { CITIES } = await import('../src/data/cities.js');
    for (const c of CITIES) cityName[c.id] = { name: c.name, state: c.state };
  } catch { /* fall back to raw city_id */ }

  let events = [];
  if (url && key) {
    try {
      const sb = createClient(url, key);
      const now = new Date();
      const cutoff = new Date(now.getTime() + HORIZON_DAYS * 86400000);
      for (let from = 0; from < MAX_PAGES; from += 1000) {
        const { data, error } = await sb.from('events')
          .select('id,title,description,venue,address,start_at,end_at,city_id,ticket_url,image_url,price')
          .eq('status', 'approved')
          .gte('start_at', now.toISOString()).lte('start_at', cutoff.toISOString())
          .order('start_at', { ascending: true }).range(from, from + 999);
        if (error) throw error;
        events.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
    } catch (e) {
      console.log(`  SEO: event fetch failed (${e.message}) — town pages only`);
      events = [];
    }
  } else {
    console.log('  SEO: no Supabase creds in env — skipping event pages (town pages only)');
  }

  // Fresh event dir each build so past events don't linger.
  const eDir = path.join(OUT, 'e');
  fs.rmSync(eDir, { recursive: true, force: true });
  fs.mkdirSync(eDir, { recursive: true });

  const eventUrls = [];
  for (const ev of events.slice(0, MAX_PAGES)) {
    const title = clean(ev.title);
    if (!title || !ev.start_at) continue;
    const town = cityName[ev.city_id] || { name: clean(ev.city_id) || 'Ohio', state: 'OH' };
    const full = clean(ev.description);
    const desc = (full.slice(0, 300) || `${title} in ${town.name}, ${town.state}.`);
    // Deduped venue/address (a majority of aggregated rows once carried the same
    // string in both fields — the raw values doubled the address in schema.org).
    const [placeName, streetAddr] = (() => {
      const parts = placeParts(ev.venue, ev.address);
      if (parts.length === 2) return parts;
      const only = parts[0] || '';
      return /\d/.test(only) && /,/.test(only) ? ['', only] : [only, ''];
    })();
    const venue = placeName;
    const dateStr = whenText(ev);
    const rel = `/e/${ev.id}.html`;
    eventUrls.push(rel);

    // 87% of the catalog is free; the rest stores display text like '$25+'.
    const priceRaw = String(ev.price || '').trim();
    const isFree = /^free$/i.test(priceRaw);
    const priceMatch = /\$\s*(\d+(?:\.\d{2})?)/.exec(priceRaw);
    const priceNum = priceMatch ? Number(priceMatch[1]) : null;
    const img = ev.image_url || '';

    const ld = {
      '@context': 'https://schema.org', '@type': 'Event', name: title,
      startDate: ev.start_at, ...(ev.end_at ? { endDate: ev.end_at } : {}),
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: {
        '@type': 'Place', name: venue || `${town.name}, ${town.state}`,
        address: { '@type': 'PostalAddress', addressLocality: town.name, addressRegion: town.state, addressCountry: 'US', ...(streetAddr ? { streetAddress: streetAddr } : {}) },
      },
      description: desc, url: `${SITE}${rel}`,
      organizer: { '@type': 'Organization', name: 'Local Loop', url: SITE },
      // image + offers are what Google's Event rich results actually want. 41%
      // of upcoming events carry a real image; the rest fall back to the social
      // card so the property is never missing.
      image: [ev.image_url || `${SITE}/og-image.png`],
      offers: {
        '@type': 'Offer',
        url: ev.ticket_url || `${SITE}${rel}`,
        availability: 'https://schema.org/InStock',
        ...(isFree
          ? { price: '0', priceCurrency: 'USD' }
          : (priceNum != null ? { price: String(priceNum), priceCurrency: 'USD' } : {})),
      },
    };

    const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)} — ${esc(town.name)}, ${esc(town.state)} | Local Loop</title>
<meta name="description" content="${esc(desc)}"/>
<link rel="canonical" href="${SITE}${rel}"/>
<meta property="og:type" content="event"/><meta property="og:url" content="${SITE}${rel}"/>
<meta property="og:title" content="${esc(title)} — ${esc(town.name)}, ${esc(town.state)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:image" content="${esc(img || `${SITE}/og-image.png`)}"/>
<meta property="og:site_name" content="Local Loop"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:image" content="${esc(img || `${SITE}/og-image.png`)}"/>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>body{margin:0;background:#FBF8F1;color:#1A1A1A;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;line-height:1.55}.wrap{max-width:640px;margin:0 auto;padding:24px 16px}.hero{background:#15315B;color:#fff;border-radius:20px;padding:22px}.hero h1{margin:0 0 6px;font-size:26px;line-height:1.15}.kick{font-size:12px;letter-spacing:1px;opacity:.75;text-transform:uppercase}.btn{display:inline-block;background:#15315B;color:#fff;text-decoration:none;font-weight:700;border-radius:999px;padding:12px 20px;margin-top:6px}.meta{color:#5B5B5B;margin:14px 0}.shot{width:100%;height:auto;border-radius:16px;margin-top:16px;display:block;background:#E9E4DA}a{color:#15315B}</style>
</head><body><div class="wrap">
<p><a href="/events/${esc(ev.city_id)}.html">&larr; All ${esc(town.name)} events</a></p>
<div class="hero"><div class="kick">${esc(town.name)}, ${esc(town.state)}</div><h1>${esc(title)}</h1><div>${esc(dateStr)}${venue ? ` &middot; ${esc(venue)}` : ''}</div></div>
${img ? `<img class="shot" src="${esc(img)}" alt="${esc(title)}" width="640" height="360" loading="lazy"/>` : ''}
<p class="meta">${esc(full.slice(0, 600) || desc)}</p>
<a class="btn" href="/event/${esc(ev.id)}">Open in Local Loop</a>
<p class="meta" style="font-size:14px;margin-top:18px">Free local events, garage sales, and food trucks across Ohio. <a href="/">Get Local Loop</a>.</p>
</div></body></html>`;
    fs.writeFileSync(path.join(eDir, `${ev.id}.html`), html);
  }

  const urls = ['/', ...townFiles.map((f) => `/events/${f}`), ...eventUrls];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join('\n')}\n</urlset>\n`;
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'), sitemap);

  console.log(`  SEO: ${eventUrls.length} event pages + ${townFiles.length} town pages -> sitemap (${urls.length} urls)`);
}
