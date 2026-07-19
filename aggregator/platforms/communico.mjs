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
  // Fetch in 30-day slices, then merge+dedup by event id. A single wide window
  // 500s on the busier instances (seen on columbus.libnet.info at 120 days), so
  // we cap each request's span; each slice retries once on a transient error, and
  // a slice that still fails never aborts the rest of the library.
  const DAY = 86400000;
  const totalDays = Math.min(120, Math.max(1, Math.ceil((cutoff - floor) / DAY)));
  const CHUNK = 30;
  const seen = new Set();
  const data = [];
  // Track slices that actually ANSWERED (HTTP ok + a JSON array), separately from how
  // many events came back. Without this, a library that is simply quiet is reported as
  // a hard failure — see the throw below.
  let okSlices = 0;
  for (let off = 0; off < totalDays; off += CHUNK) {
    const days = Math.min(CHUNK, totalDays - off);
    const date = new Date(floor + off * DAY).toISOString().slice(0, 10);
    const req = encodeURIComponent(JSON.stringify({ private: false, date, days }));
    const url = `${host}/eeventcaldata?event_type=0&req=${req}`;
    let arr = null;
    for (let attempt = 0; attempt < 2 && !arr; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 600));
      try {
        const res = await fetch(url, { headers: UA });
        if (!res.ok) continue;
        const j = await res.json();
        if (Array.isArray(j)) arr = j;
      } catch { /* transient — retry once */ }
    }
    if (!arr) continue; // this slice failed both attempts; keep the rest
    okSlices++;
    for (const e of arr) {
      const k = e && e.id != null ? String(e.id) : `${e && e.title}|${e && e.raw_start_time}`;
      if (seen.has(k)) continue;
      seen.add(k);
      data.push(e);
    }
  }
  // Only a TRANSPORT failure is an error. "Every slice answered, and the library has
  // nothing scheduled" is a legitimate empty result, not a dead feed — Massillon
  // Public Library returns a valid [] across all 120 days and was being reported as
  // DEAD for it (found 2026-07-19 while clearing the board for feed-health alerting).
  // Conflating the two produces false alarms, which is how alerting stops being
  // trusted. An empty return lands in feed-health's ZERO-EVENT bucket instead.
  if (!okSlices) throw new Error('Communico unreachable (every slice failed)');
  if (!data.length) return [];

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
