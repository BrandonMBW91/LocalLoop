// Monthly headless scrape of the Marathon Center for the Performing Arts
// (mcpa.org) — a marquee Findlay venue whose site is fully JS-rendered with no
// iCal/JSON-LD feed. Renders the listing + each event's detail page, extracts
// title / next date / registration link / artwork, and upserts into events.
// Run monthly (events don't change often):
//   node mcpa.mjs            # write
//   node mcpa.mjs --dry-run  # print only
//
// Needs puppeteer (installed ad-hoc; not in the daily aggregator deps).

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';
import { loadDotEnv } from './env.mjs';

loadDotEnv();
const DRY_RUN = process.argv.includes('--dry-run');

const VENUE = 'Marathon Center for the Performing Arts';
const ADDRESS = '200 West Main Cross Street, Findlay, OH 45840';
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function parseDateTime(body, floorMs) {
  // All "Month D, YYYY" occurrences; keep the earliest that hasn't passed.
  const dates = [...body.matchAll(/\b([A-Z][a-z]{2,8})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)]
    .map((m) => {
      const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (mon == null) return null;
      return new Date(Number(m[3]), mon, Number(m[2]), 19, 0, 0); // default 7pm
    })
    .filter((d) => d && !isNaN(d) && d.getTime() >= floorMs)
    .sort((a, b) => a - b);
  if (!dates.length) return null;
  const start = dates[0];
  const tm = body.match(/\b(\d{1,2}):(\d{2})\s*([APap][Mm])\b/);
  if (tm) {
    let h = Number(tm[1]) % 12;
    if (/p/i.test(tm[3])) h += 12;
    start.setHours(h, Number(tm[2]), 0, 0);
  }
  return start;
}

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');

  await page.goto('https://www.mcpa.org/events', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  const cards = await page.evaluate(() => {
    const seen = new Set(); const out = [];
    for (const a of document.querySelectorAll('a[href*="/events/detail/"]')) {
      if (seen.has(a.href)) continue; seen.add(a.href);
      let card = a;
      while (card.parentElement && card.parentElement.querySelectorAll('a[href*="/events/detail/"]').length === 1) card = card.parentElement;
      const img = card.querySelector('img');
      out.push({ url: a.href, image: img ? (img.src || '') : '' });
    }
    return out;
  });
  console.log(`listing: ${cards.length} events`);

  const floorMs = Date.now() - 12 * 3600 * 1000;
  const rows = [];
  for (const c of cards) {
    try {
      await page.goto(c.url, { waitUntil: 'networkidle2', timeout: 45000 });
      await new Promise((r) => setTimeout(r, 1200));
      const d = await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        const title = ((h1 && h1.innerText) || document.title || '').replace(/\s*\|\s*Marathon Center.*$/i, '').trim();
        const body = (document.body.innerText || '').replace(/\r/g, ' ');
        const link = Array.from(document.querySelectorAll('a'))
          .map((a) => a.href)
          .find((h) => /coursestorm|libraryc|ticket|eventbrite|showare|etix|ovationtix|audienceview/i.test(h) && !/\/events\b/.test(h));
        return { title, body: body.slice(0, 4000), link: link || '' };
      });
      const start = parseDateTime(d.body, floorMs);
      if (!d.title || !start) continue;
      const title = d.title.slice(0, 200);
      const startIso = start.toISOString();
      const source_uid = createHash('sha1').update(`findlay|${title.toLowerCase()}|${startIso}`).digest('hex').slice(0, 24);
      rows.push({
        city_id: 'findlay', title, category: 'Arts', emoji: '🎨',
        start_at: startIso, end_at: null, venue: VENUE, address: ADDRESS,
        price: /coursestorm|ticket|libraryc/i.test(d.link) ? 'See details' : 'Free',
        host: VENUE, description: `${title} at the Marathon Center for the Performing Arts.`,
        source_uid, image_url: /^https:\/\//.test(c.image) ? c.image : null,
        ticket_url: /^https:\/\//.test(d.link) ? d.link : c.url,
      });
    } catch (e) {
      console.error(`  ! ${c.url}: ${e.message}`);
    }
  }
  await browser.close();

  // de-dupe within this run
  const seen = new Set();
  const unique = rows.filter((r) => (seen.has(r.source_uid) ? false : seen.add(r.source_uid)));
  console.log(`parsed ${unique.length} dated events`);

  if (DRY_RUN) {
    unique.forEach((r) => console.log(`  ${r.start_at.slice(0, 16)}  ${r.title.slice(0, 50)}  [${r.price}]  ${r.image_url ? 'img' : 'no-img'}`));
    console.log('(dry run — nothing written)');
    return;
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const uids = unique.map((r) => r.source_uid);
  const { data: have } = await sb.from('events').select('source_uid').in('source_uid', uids);
  const has = new Set((have || []).map((r) => r.source_uid));
  const newRows = unique.filter((r) => !has.has(r.source_uid));
  if (!newRows.length) { console.log('no new MCPA events'); return; }
  const { data, error } = await sb.from('events').upsert(newRows, { onConflict: 'source_uid', ignoreDuplicates: true }).select('id');
  if (error) { console.error('write error:', error.message); process.exit(1); }
  console.log(`Added ${data ? data.length : 0} new MCPA event(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
