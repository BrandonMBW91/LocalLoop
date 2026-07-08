// Communico "Attend" — library calendars on {sub}.libnet.info (and custom domains
// like services.akronlibrary.org). Public JSON, no key. Verified on delawarelibrary,
// mrcpl (Mansfield), marysvillelib, portagelibrary, reedlibrary (Ravenna).
//   event_sources row: type 'communico', url = the events host (e.g.
//   https://delawarelibrary.libnet.info), city_id = fallback town.
//
// API (live-verified 2026-07): GET
//   {host}/eeventcaldata?event_type=0&req={urlencoded {"private":false,"date":"YYYY-MM-DD","days":N}}
// → bare JSON array. Times are LOCAL Eastern wall-clock ("2026-07-08 10:30:00").
// Branch street addresses come from a second open endpoint,
//   https://api.communico.co/v1/{sub}/locations  (join event.location_id → id);
// when that 404s (custom domains), we fall back to branch name only — the town
// router still works because branch names carry the town ("Ontario Branch").
// Rows with changed=1 are cancelled/rescheduled — the site itself hides them.

import { etToDate } from '../et.mjs';

const UA = { 'User-Agent': 'Mozilla/5.0 (LocalLoop aggregator)' };
const trim = (s) => String(s || '').trim();

export async function pull(source, { floor, cutoff }) {
  const host = source.url.replace(/\/+$/, '');
  const sub = new URL(host).hostname.split('.')[0];
  const days = Math.min(120, Math.ceil((cutoff - floor) / 86400000));
  const req = encodeURIComponent(JSON.stringify({
    private: false,
    date: new Date(floor).toISOString().slice(0, 10),
    days,
  }));

  const res = await fetch(`${host}/eeventcaldata?event_type=0&req=${req}`, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('not a JSON array (Communico shape changed)');

  // Branch address book (best-effort — custom domains may not resolve on the API host).
  const branchAddr = new Map();
  try {
    const lr = await fetch(`https://api.communico.co/v1/${sub}/locations`, { headers: UA });
    if (lr.ok) {
      const lj = await lr.json();
      for (const l of lj?.data?.locations || lj?.locations || (Array.isArray(lj) ? lj : [])) {
        if (!l?.id) continue;
        const parts = [trim(l.line1), trim(l.locality), `${trim(l.stateprovincecounty)} ${trim(l.ziporpostcode)}`.trim()];
        branchAddr.set(String(l.id), parts.filter(Boolean).join(', '));
      }
    }
  } catch { /* best-effort */ }

  const out = [];
  for (const e of data) {
    if (!e?.title || !e.raw_start_time) continue;
    if (parseInt(e.changed, 10) === 1) continue; // cancelled/rescheduled — site hides these
    const start = etToDate(e.raw_start_time);
    if (!start) continue;
    // Midnight starts are bookmobile/outreach "all day" entries.
    const allDay = /\b00:00:00$/.test(e.raw_start_time);
    const branch = trim(e.location || e.library);
    const rooms = trim(e.venues);
    const address = branchAddr.get(String(e.location_id)) || '';
    const location = `${branch}${rooms ? ` (${rooms.split(',')[0]})` : ''}${address ? `, ${address}` : ''}`;
    out.push({
      summary: trim(e.title),
      description: String(e.description || e.long_description || ''),
      location,
      url: /^https:\/\//.test(e.url || '') ? e.url : null,
      image: e.image ? `${host}/images/events/${sub}/${encodeURIComponent(e.image)}` : null,
      start,
      end: e.raw_end_time ? etToDate(e.raw_end_time) : null,
      allDay,
    });
  }
  return out;
}
