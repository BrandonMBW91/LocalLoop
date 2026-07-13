// Pin this process to UTC BEFORE any date-handling library loads. Must be the
// FIRST import of the entry module (ESM imports hoist, so a bare statement in
// the entry file would run too late).
//
// Why: rrule 2.8.1 expands TZID recurrences 4-5 hours early when the machine
// timezone equals the event's TZID (its dateInTimeZone computes a zero offset
// and returns wall-time-as-UTC unconverted), and node-ical mints VALUE=DATE
// values at server-local midnight — so the ET desktop and UTC CI runners
// produced different instants (and different source_uids) for the same events.
// With TZ pinned, every runner behaves like CI; the remaining date-only
// correctness comes from anchoring by calendar components (see aggregate.mjs
// noonETFromLocalDay). Verified working on Windows Node (Date honors TZ).
process.env.TZ = 'UTC';
