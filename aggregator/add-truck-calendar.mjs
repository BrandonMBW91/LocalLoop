// Register a food truck's calendar so their stops auto-ingest daily. Run when a
// truck replies with their Google Calendar / iCal link.
//   node add-truck-calendar.mjs "Jonny Burritos" findlay "Burritos / Tex-Mex" "https://calendar.google.com/calendar/ical/.../public/basic.ics"
// Google Calendar link: the truck's calendar → Settings → "Public address in iCal
// format" (the .ics URL). Also accepts a bare "webcal://" (auto-normalized).
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';

loadDotEnv();
const [, , name, cityId, cuisine, urlRaw] = process.argv;
if (!name || !cityId || !urlRaw) {
  console.error('usage: add-truck-calendar.mjs "<name>" <city_id> "<cuisine>" "<ical_url>"');
  process.exit(1);
}
const url = urlRaw.replace(/^webcal:\/\//i, 'https://');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Quick sanity fetch so we fail loudly on a bad link instead of registering junk.
try {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (LocalLoop)' }, redirect: 'follow' });
  const text = await res.text();
  if (!res.ok || !/BEGIN:VCALENDAR/i.test(text)) throw new Error(`not a valid iCal feed (HTTP ${res.status})`);
  const vevents = (text.match(/BEGIN:VEVENT/g) || []).length;
  console.log(`Feed looks good: ${vevents} events found.`);
} catch (e) {
  console.error(`Link check FAILED: ${e.message}\nDouble-check the iCal URL before registering.`);
  process.exit(1);
}

const { data, error } = await sb.from('truck_calendars')
  .insert({ name, city_id: cityId, cuisine: cuisine || 'Food truck', ical_url: url })
  .select('id');
if (error) { console.error(error.message); process.exit(1); }
console.log(`Registered "${name}" (${cityId}) -> ${data[0].id}`);
console.log('Run `node truck-calendars.mjs` now to ingest immediately, or wait for the daily run.');
