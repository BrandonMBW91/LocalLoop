// One-off remediation of the Jul 9 audit's confirmed data defects. Idempotent.
//   node cleanup-audit.mjs --dry-run   (counts only)
//   node cleanup-audit.mjs             (apply)
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const token = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1].trim();
// Accepts BOTH spellings on purpose. The repo had scripts taking --dry and others
// taking --dry-run, so typing the wrong one at the wrong script ran it FOR REAL with no
// warning. That happened on 2026-07-21: 'seatgeek.mjs --dry' was a live import.
// Widening the match can only ever make a run more dry, never less.
const DRY = process.argv.includes('--dry-run') || process.argv.includes('--dry');
const sql = (q) =>
  fetch('https://api.supabase.com/v1/projects/wtaefyspddadcrnovumk/database/query', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  }).then((r) => r.json());

// 1) end_at < start_at: Eventbrite midnight-rollover — the end time crossed
//    midnight and never rolled to the next day. Add 24h (only where that makes
//    it valid); otherwise null the end rather than leave it backwards.
const fix1 = DRY
  ? `select count(*)::int n from events where end_at < start_at`
  : `update events set end_at = end_at + interval '24 hours'
       where end_at < start_at and end_at + interval '24 hours' >= start_at`;
console.log('1) end<start:', JSON.stringify(await sql(fix1)));
if (!DRY) {
  console.log('   still-backwards after +24h (nulled):',
    JSON.stringify(await sql(`update events set end_at = null where end_at < start_at`)));
}

// 2) Noon-pair twins: keep the 16:00Z (correct ET-noon) copy, delete the 12:00Z
//    (stale pre-Jul-8 server-local-noon) copy of each same title/venue/city/ET-day pair.
const twinDelete = `
  with utc as (
    select id, title, venue, city_id,
           (start_at at time zone 'America/New_York')::date d,
           (start_at at time zone 'UTC')::time t
    from events where status='approved' and start_at >= now()
  ),
  pairs as (
    select title, venue, city_id, d
    from utc group by 1,2,3,4
    having count(*) filter (where t = time '12:00') > 0
       and count(*) filter (where t = time '16:00') > 0
  )
  ${DRY ? 'select count(*)::int n' : 'delete'} from events e
  where ${DRY ? '' : ''} e.id in (
    select u.id from utc u join pairs p
      on u.title=p.title and coalesce(u.venue,'')=coalesce(p.venue,'')
     and u.city_id=p.city_id and u.d=p.d
    where u.t = time '12:00'
  )`;
console.log('2) noon-twin 12:00Z copies:', JSON.stringify(await sql(twinDelete)));

// 3) Bogus geocodes: null coords (keep the event, drop the wrong map pin) for
//    the fallback-cluster point and anything outside Ohio's bounding box.
const geoFix = DRY
  ? `select count(*)::int n from events where lat is not null and (round(lat::numeric,2)=41.59 and round(lng::numeric,2)=-80.64 or lat<38.4 or lat>42.3 or lng<-84.9 or lng>-80.5)`
  : `update events set lat=null, lng=null
       where lat is not null and (
         (round(lat::numeric,2)=41.59 and round(lng::numeric,2)=-80.64)
         or lat<38.4 or lat>42.3 or lng<-84.9 or lng>-80.5)`;
console.log('3) bogus geocodes nulled:', JSON.stringify(await sql(geoFix)));
