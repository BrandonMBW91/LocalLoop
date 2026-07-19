// One-off: fill the 2026 Ohio State Fair gaps in Columbus (Jul 29 - Aug 9).
// ohiostatefair.com has NO machine-readable feed (proprietary CMS), so the schedule
// was supplied manually. Checking it against the DB showed Ticketmaster ALREADY has
// every paid grandstand concert at the right times, so re-loading those would just
// mint duplicates. Two things were genuinely missing, and both are the kind of thing
// ticketing platforms never carry:
//   1. the FREE concerts (Journey from the Heart, TUSK) — no ticket, so no TM listing
//   2. an end date on the fair itself — SeatGeek's row is a single 3:30am point with
//      end_at NULL, so a 12-day fair would disappear from the app after Jul 29.
// The ~500 remaining schedule rows are daily repeats (Pig Races, Zoltar, 4-H judging,
// Coffee Bar) deliberately NOT loaded — they'd bury every other Columbus event.
//   node load-ohio-state-fair.mjs           # dry run
//   node load-ohio-state-fair.mjs --apply
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const t = read('../.env') + '\n' + read('.env');
const g = (k) => (new RegExp('^' + k + '=(.*)$', 'm').exec(t) || [])[1]?.trim();
const SB = g('EXPO_PUBLIC_SUPABASE_URL') || g('SUPABASE_URL'), KEY = g('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const APPLY = process.argv.includes('--apply');

const CITY = 'columbus';
const VENUE = 'Ohio Expo Center & State Fairgrounds';
const ADDRESS = '717 East 17th Avenue, Columbus, OH 43211';
const LINK = 'https://www.ohiostatefair.com/p/entertainment';
const FAIR_ROW = 'fb83a1a7-b1d8-47f2-952e-f635ae3376ab'; // SeatGeek "Ohio State Fair"

function etDate(y, mo, d, h = 0, mi = 0) {
  const asUTC = Date.UTC(y, mo - 1, d, h, mi, 0);
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(asUTC));
  const gp = (x) => Number((p.find((q) => q.type === x) || {}).value);
  const wall = Date.UTC(gp('year'), gp('month') - 1, gp('day'), gp('hour') % 24, gp('minute'));
  return new Date(asUTC - (wall - asUTC));
}
const uid = (city, title, startIso) =>
  createHash('sha1').update(`${city}|${title.toLowerCase()}|${startIso}`).digest('hex').slice(0, 24);

// The two FREE grandstand shows Ticketmaster has no listing for.
const MISSING = [
  [8, 4, 13, 0, 'Journey from the Heart', 'A free tribute concert at the Ohio State Fair, included with fair admission.'],
  [8, 6, 19, 0, 'TUSK: The classic tribute to Fleetwood Mac', 'A free Fleetwood Mac tribute at the Ohio State Fair, included with fair admission.'],
];

const rows = MISSING.map(([mo, d, h, mi, title, desc]) => {
  const startIso = etDate(2026, mo, d, h, mi).toISOString();
  return {
    city_id: CITY, title, category: 'Music', emoji: '🎵',
    start_at: startIso, end_at: null, venue: VENUE, address: ADDRESS,
    price: 'Free with fair admission', host: 'Ohio State Fair', description: desc,
    source_uid: uid(CITY, title, startIso), ticket_url: LINK, status: 'approved',
  };
});

// Give the fair itself a real end date so it stays visible all 12 days.
const fairEnd = etDate(2026, 8, 9, 22, 0).toISOString(); // fair closes ~10pm ET on the final day

console.log('Would add these MISSING free concerts:');
rows.forEach((r) => console.log(`   ${r.start_at.slice(0, 16)}  ${r.title}  (${r.price})`));
console.log(`\nWould set end_at on the existing "Ohio State Fair" row -> ${fairEnd}`);
console.log('   (so the 12-day fair stays in the feed instead of vanishing after Jul 29)');
console.log('\nSKIPPED (Ticketmaster already has them): Styx, Blippi, S.O.S./Dazz, Alison Krauss,');
console.log('   Sammy Kershaw, for KING & COUNTRY, Nelly, Weird Al, Bailey Zimmerman, Blues Traveler.');

if (!APPLY) { console.log('\nDRY RUN — re-run with --apply.'); process.exit(0); }

const res = await fetch(`${SB}/rest/v1/events?on_conflict=source_uid`, {
  method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=representation' },
  body: JSON.stringify(rows),
});
if (!res.ok) { console.error('insert failed:', res.status, await res.text()); process.exit(1); }
console.log(`\nLoaded ${(await res.json()).length} free concert(s).`);

const up = await fetch(`${SB}/rest/v1/events?id=eq.${FAIR_ROW}`, {
  method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({ end_at: fairEnd }),
});
const u = await up.json();
console.log(`Fair row end_at -> ${up.status} ${u[0] ? u[0].end_at : '(not found)'}`);
