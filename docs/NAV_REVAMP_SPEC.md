# Navigation revamp — build spec (execute after App Store approval)

Goal: replace the five-tab bar (Events · Sales · Food · Post · Settings) with a
clean **four-tab** bar led by a curated **Today** home, move the empty-at-launch
user-generated tabs into a **Local** hub, and relocate Settings. The whole change
is JavaScript only, so it ships **over-the-air** (`eas update`) with no rebuild.

DO NOT START until the current 1.0.0 submission is approved. Changing nav mid-review
risks confusing the reviewer.

---

## Target navigation

Bottom bar (4 tabs, left to right):

| Tab | Route | Purpose |
|-----|-------|---------|
| **Today** | `(tabs)/index.js` | Curated home feed. App lands here. |
| **Events** | `(tabs)/events.js` | The existing full events list (renamed from today's `index.js`). |
| **Post** | `(tabs)/post.js` | Unchanged. Create event / garage sale / food truck. |
| **Local** | `(tabs)/local.js` | Hub grid holding everything secondary. |

Hidden routes (kept, removed from the bar via `href: null` so they stay navigable):
`garage-sales`, `food-trucks`, `settings`.

Rationale: at launch only Events has content. Garage Sales and Food Trucks are
user-generated and start empty, so they live in the Local hub until real posts
accumulate. Promote one back onto the bar (or hand the 5th slot to a seasonal mode
like Holiday Lights / School Closings) once it earns it.

---

## File changes

### 1. `app/(tabs)/_layout.js`
- Rename the current `index` Tabs.Screen (Events) usage; see step 2.
- New tab order, all `headerShown: false`:
  1. `index` → label "Today", icon `home` (Ionicons `home` / `home-outline`).
  2. `events` → label "Events", icon `calendar`.
  3. `post` → label "Post", icon `add-circle` (keep larger size).
  4. `local` → label "Local", icon `apps` (Ionicons `apps` / `grid`).
- Add for the de-tabbed screens so they exist but don't render a button:
  ```js
  <Tabs.Screen name="garage-sales" options={{ href: null, headerShown: false }} />
  <Tabs.Screen name="food-trucks"  options={{ href: null, headerShown: false }} />
  <Tabs.Screen name="settings"     options={{ href: null }} />
  ```
- Keep the `navScale` cap; with 4 tabs labels have more room.

### 2. Events screen relocation
- `git mv app/(tabs)/index.js app/(tabs)/events.js` (this is the existing Events
  list, unchanged internally). Update any internal self-links if present (none expected).
- Create a NEW `app/(tabs)/index.js` = the Today home (step 3).
- Anything that does `router.push('/')` or navigates to the Events tab to mean
  "the events list" should target `/events`. The Map/Calendar header buttons inside
  the Events screen stay as-is.

### 3. `app/(tabs)/index.js` — new Today home
A scrollable, curated feed. Pulls from existing `useApp()` state — no new backend.
Header: green, title "Today", eyebrow `"<weekday>, <Mon D> · {city.name}, {city.state}"`,
top-right gear icon → `router.push('/settings')`.

Quick-links row (horizontal, 4 chips → existing routes):
`Map → /map`, `Deals → /deals`, `Saved → /saved`, `Calendar → /calendar`.

Feed sections, in order, each rendered only if it has content:
1. **Editor's Pick** — reuse `EditorPickBanner` with `editorPick` from context.
2. **Happening today** — `events.filter(e => daysFromNow(e.start) === 0)`, featured
   first, cap 3. Reuse `EventCard`. Section header "Happening today".
3. **This weekend** — `events.filter(e => isThisWeekend(e.start))`, cap 2. Only show
   if today's list was thin (< 3) so the feed always has substance.
4. **Deals nudge** — if `deals.length > 0`, the accent banner row → `/deals`
   (reuse the banner already in the events list header).
5. **From your neighbors** — most recent `garageSales` + `foodTrucks` (cap 2 total),
   reuse `GarageSaleCard` / `FoodTruckCard`. Hidden entirely when both are empty
   (the launch state), so no empty section ever shows.
6. **Seasonal slot (future)** — a single card at the top when active (winter: a
   School Closings summary or Holiday Lights teaser). Leave a `// TODO seasonal`
   placeholder; wired later.

Empty-safety: Events has 150+ rows so sections 2–3 guarantee the feed is never empty.
If `loadingData`, show `SkeletonList`.

### 4. `app/(tabs)/local.js` — new Local hub
Header: green, title "Local", eyebrow "{city.name}, {city.state}".
Two labeled groups of tiles (2-column grid, tap → `router.push`). No status pills;
keep it calm.

- **Browse:** Garage sales → `/garage-sales`, Food trucks → `/food-trucks`,
  Map → `/map`, Local deals → `/deals`.
- **You:** Saved → `/saved`, Your interests → `/interests`, Settings → `/settings`.

Tile = white card, 1px border `colors.border`, radius 14, an icon chip (tinted
`colors.primary` 10%) + label. Garage sales/food trucks may use their brand accents
(`colors.garageSale`, `colors.foodTruck`) on the icon chip for recognizability.

As features ship, add a tile here (and, when relevant, make it feed-eligible in Today).
This is the permanent expansion surface — the bar never grows past 4 unless real
content earns a 5th slot.

### 5. Settings
- Stays at `app/(tabs)/settings.js`, just `href: null` in the tab config.
- Reached from the Today header gear AND the Local "You" group. Both push `/settings`.
- The existing MODERATOR section (incl. This week's pick, Manage deals) is unchanged.

---

## Rollout
1. Branch, implement, parse-check every changed file (esbuild `--loader:.js=jsx`).
2. Verify on web (`npm run web`, port 8081): lands on Today, all 4 tabs work, quick
   links and hub tiles route correctly, empty "From your neighbors" stays hidden.
3. Bump `BUILD` in `src/version.js`.
4. `eas update --branch production` (runtime stays the pinned `1aa93c…` string —
   JS only, native fingerprint unchanged, so it reaches Build 3/4 installs).
5. Settings shows the new rev; confirm the bar changed on a real device.

## Future hooks (not in this pass)
- **Seasonal 5th tab:** when winter or supply warrants, add a 5th Tabs.Screen
  (Holiday Lights / Closings / Sales) — admin-switchable label/content.
- **Planned features** (jobs, obituaries, ask-a-local, closings, river alerts, HS
  sports, lost & found): each ships as a new stack route + a Local hub tile, and
  becomes eligible to surface as a Today feed card when relevant. The bar stays 4.
