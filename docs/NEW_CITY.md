# Adding a city to Local Loop

A town has to line up across a few places (picker, matcher, anchor, feeds). Use the
scaffold — it does the edits and runs the config gate for you — then wire a feed and
verify the town actually has events before shipping.

## 1. Scaffold the town

```
cd aggregator
node add-city.mjs --id=<kebab-id> --name="<Display Name>" \
  --region="Northwest Ohio|Central Ohio|Northeast Ohio" \
  --tagline="<short tagline>" --lat=<lat> --lng=<lng>
```

It validates the id (kebab-case) and region, **warns on name collisions** (Marion,
Troy, Dover, Delaware, Ontario, Bryan… share a name with out-of-state cities — the
matcher now drops those, but confirm), inserts the `CITIES` row (`src/data/cities.js`)
and the `NAMES` matcher (`aggregator/towns.mjs`) in a collision-safe position, reports
**anchor coverage**, and runs `check-cities`.

- `--dry-run` previews without writing; `--force` proceeds past a collision warning.
- If it prints **NOT inside any anchor**, add one to `aggregator/geo.mjs`
  (`{ name, city: '<id>', lat, lng, radius }`) or the town gets zero ticketed events.

## 2. Wire at least one feed (or it's a ghost town)

A town with no feed and few ticketed events ships empty. Add a real source:

- **Normal calendar** (iCal / JSON-LD / Revize) → a row in the `event_sources` table:
  `(city_id, name, type, url, default_category, enabled)`. Confirm the URL returns
  `BEGIN:VCALENDAR` (iCal) or JSON-LD Events first.
- **LibraryMarket library** (`*.librarycalendar.com` / LC Events) → add
  `{ host, city_id, name }` to `LIBS` in `aggregator/librarymarket.mjs`.
- **Eventbrite baseline** (always available): a `jsonld` row with
  `https://www.eventbrite.com/d/oh--<id>/all-events/`.

Common iCal URL patterns: WhoFi `https://{slug}.whofi.com/calendar/ical`; LibCal
`https://{sub}.libcal.com/ical_subscribe.php?cid={N}`; The Events Calendar (WordPress)
`?ical=1`; Squarespace `?format=ical`; CivicPlus
`/common/modules/iCalendar/iCalendar.aspx?catID={N}&feed=calendar`.

## 3. Aggregate + verify no ghost town

```
node run-all.mjs         # validates config (hard gate), pulls all sources, builds pages
node check-content.mjs   # per-town upcoming counts; flags GHOST (0) and THIN (<5)
```

If `check-content` shows the new town as a **GHOST**, do not ship it — find it a feed
or hold it out of `cities.js`.

## 4. Ship the app (OTA)

The picker reads bundled `cities.js`, so a new town needs an OTA:

```
# bump BUILD in src/version.js, then:
npx eas update --branch production --message "Add <town> - rev <N>"
```

## 5. Ship the website

```
git add -A && git commit -m "Add <town>" && git push origin main
gh workflow run aggregate.yml    # regenerates + deploys localloop.io (or wait for the daily cron)
```

## The gates (wired into run-all.mjs and CI)

- **`check-cities.mjs`** — config + matcher regression gate: golden out-of-state
  collision cases (`Marion, IN` → null), `anchor.city` validation, id format, and the
  `NAMES` shorter-after-longer ordering rule. Runs first; hard-fails the pipeline.
- **`check-content.mjs [--strict --allow=<ids>]`** — per-town ghost/thin report. In CI
  it hard-blocks a deploy on an *unexpected* ghost; known-legacy empties go in `--allow`.
