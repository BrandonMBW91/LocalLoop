import { supabase } from './supabase.js';
import { cleanText, cleanLocation, cleanDescription } from './text.js';
import { effectiveEndMs } from './eventTime.js';
import { nyDateKey, nyOffsetHours } from '../utils/dates.js';

// Today's date in Eastern time as 'YYYY-MM-DD' (date-only strings sort
// chronologically), used to expire past garage sales and food trucks. Uses the
// Hermes-safe nyDateKey (no Intl/timeZone) so Android and iOS agree on "today".
// "3 PM" / "10:30 AM" clock text -> minutes since midnight, or null. Used to
// drop a truck stop / garage sale's FINAL day once its posted end time passes
// (they used to sit under a green TODAY badge until midnight).
function clockMinutes(s) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?/i.exec(String(s || ''));
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (/p/i.test(m[3])) h += 12;
  return h * 60 + (m[2] ? parseInt(m[2], 10) : 0);
}
// Minutes since ET midnight. Uses the project's own DST math, NOT
// Intl.DateTimeFormat({ timeZone }) — Android's Hermes has unreliable Intl/ICU
// (see the note above nyOffsetHours in utils/dates.js), so an Intl timeZone here
// either throws or silently returns LOCAL time. This runs on every food-truck and
// garage-sale fetch, so it has to be Hermes-safe.
function nowMinutesET() {
  const now = new Date();
  const shifted = new Date(now.getTime() + nyOffsetHours(now) * 3600 * 1000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function todayKeyET() {
  return nyDateKey();
}

// A listing is "featured" only while its paid promotion is still current.
// (A daily job also flips the boolean off, but this keeps the badge honest the
// moment the date passes, regardless of when that job last ran.)
function isFeatured(r) {
  if (!r.featured) return false;
  if (!r.featured_until) return true; // manually featured, no expiry
  return Date.parse(r.featured_until) > Date.now();
}

// ---- Mappers: database rows (snake_case) <-> app objects (camelCase) ----

function rowToEvent(r) {
  // Default every text field the UI may search or call string methods on, so a
  // row with a missing field can never crash a card or the search filter.
  return {
    id: r.id,
    cityId: r.city_id,
    title: cleanText(r.title) || 'Untitled event',
    category: r.category || 'Community',
    emoji: r.emoji,
    start: r.start_at,
    end: r.end_at,
    venue: cleanLocation(r.venue),
    address: cleanLocation(r.address),
    price: r.price || 'See details',
    host: cleanText(r.host) || 'Community submission',
    featured: isFeatured(r),
    featuredUntil: r.featured_until,
    viewCount: r.view_count,
    lat: r.lat,
    lng: r.lng,
    imageUrl: r.image_url || null,
    ticketUrl: r.ticket_url || null,
    pending: r.status !== 'approved',
    description: cleanDescription(r.description),
    // Non-null = this row is ingested from a calendar feed; the aggregator
    // re-upserts it nightly, so in-app edits to feed events would be clobbered.
    // Gates the admin Edit button to user/admin-created events only.
    sourceUid: r.source_uid || null,
    // Who posted it. Lets the app show "Edit" to the owner, not just the admin.
    createdBy: r.created_by || null,
  };
}

function eventToRow(e) {
  return {
    city_id: e.cityId,
    title: e.title,
    category: e.category,
    emoji: e.emoji,
    start_at: e.start,
    end_at: e.end,
    venue: e.venue,
    address: e.address,
    price: e.price,
    host: e.host,
    featured: false,
    description: e.description,
    image_url: e.imageUrl || null,
    // status defaults to 'pending' in the database — never trust the client.
  };
}

function rowToSale(r) {
  return {
    id: r.id,
    cityId: r.city_id,
    title: cleanText(r.title) || 'Garage sale',
    type: r.type || 'Garage Sale',
    start: r.start_date,
    end: r.end_date,
    dailyStart: r.daily_start,
    dailyEnd: r.daily_end,
    address: cleanLocation(r.address),
    neighborhood: cleanLocation(r.neighborhood),
    items: r.items || [],
    images: r.images || [],
    featured: isFeatured(r),
    featuredUntil: r.featured_until,
    viewCount: r.view_count,
    host: cleanText(r.host) || 'Community submission',
    pending: r.status !== 'approved',
    note: cleanDescription(r.note),
    createdBy: r.created_by || null, // lets the poster see Edit on their own sale
  };
}

function saleToRow(s) {
  return {
    city_id: s.cityId,
    title: s.title,
    type: s.type,
    start_date: s.start,
    end_date: s.end,
    daily_start: s.dailyStart,
    daily_end: s.dailyEnd,
    address: s.address,
    neighborhood: s.neighborhood || '',
    items: s.items || [],
    images: s.images || [],
    host: s.host,
    note: s.note,
  };
}

function rowToTruck(r) {
  return {
    id: r.id,
    cityId: r.city_id,
    name: cleanText(r.name) || 'Food truck',
    cuisine: r.cuisine || 'Other',
    date: r.date,
    startTime: r.start_time || '',
    endTime: r.end_time || '',
    locationName: cleanLocation(r.location_name),
    address: cleanLocation(r.address),
    featured: isFeatured(r),
    featuredUntil: r.featured_until,
    viewCount: r.view_count,
    host: cleanText(r.host) || 'Community submission',
    // source_uid is set only by the calendar-pull aggregator; user submissions
    // have none. Lets the card show an honest byline instead of always claiming
    // "Posted by a neighbor" on official truck-calendar stops.
    source: r.source_uid ? 'calendar' : 'community',
    pending: r.status !== 'approved',
    note: cleanDescription(r.note),
    imageUrl: r.image_url || null,
    createdBy: r.created_by || null, // lets the poster see Edit on their own stop
  };
}

function truckToRow(t) {
  return {
    city_id: t.cityId,
    name: t.name,
    cuisine: t.cuisine,
    date: t.date,
    start_time: t.startTime,
    end_time: t.endTime,
    location_name: t.locationName,
    address: t.address,
    host: t.host,
    note: t.note,
    image_url: t.imageUrl || null,
  };
}

// Decode base64 (from the image picker) into bytes for upload.
function decodeBase64(b64) {
  const bin = globalThis.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Upload picked photos to the 'sale-photos' storage bucket; return public URLs.
export async function uploadSalePhotos(photos = []) {
  const urls = [];
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    if (!p?.base64) continue;
    const path = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await supabase.storage
      .from('sale-photos')
      .upload(path, decodeBase64(p.base64), { contentType: 'image/jpeg' });
    if (error) throw error;
    const { data } = supabase.storage.from('sale-photos').getPublicUrl(path);
    urls.push(data.publicUrl);
  }
  return urls;
}

// ---- Reads (public sees approved; a signed-in user also sees their own) ----

export async function fetchEvents(cityId) {
  // Keep events that started earlier today, AND multi-day events that are still
  // running (start_at in the past but end_at in the future) — a festival or fair
  // shouldn't vanish on day two. Ongoing events bucket into "Today" in the UI.
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();
  // Paginate past PostgREST's 1000-row cap — a busy town (Akron already has 1000+
  // upcoming) was silently dropping its furthest-future events from the list,
  // calendar, and map with no error.
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('city_id', cityId)
      .eq('status', 'approved')
      .or(`start_at.gte.${cutoff},end_at.gte.${nowIso}`)
      .order('featured', { ascending: false })
      .order('start_at', { ascending: true })
      .order('id', { ascending: true }) // unique tiebreaker so pages don't dupe/drop rows
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  // Drop events that have already ended — by their real end time, or an estimate
  // for the ~6% of feeds that omit one — so a noon event doesn't sit on "today"
  // until midnight. Upcoming and still-running events are kept.
  const now = Date.now();
  return rows
    .map(rowToEvent)
    .filter((e) => effectiveEndMs(e.start, e.end, e.title, e.category) >= now);
}

// Single-row fetch by id, any town — powers deep links (localloop.io/event/<id>)
// when the item isn't in the currently-loaded city. Returns null if missing.
export async function fetchOneById(kind, id) {
  const table = TABLE_BY_KIND[kind];
  const mapper = kind === 'garage_sale' ? rowToSale : kind === 'food_truck' ? rowToTruck : rowToEvent;
  if (!table || !id) return null;
  const { data, error } = await supabase.from(table).select('*').eq('id', id).eq('status', 'approved').maybeSingle();
  if (error || !data) return null;
  return mapper(data);
}

// ---- Editor's Pick (admin-curated "This Week's Pick" per town) ----

export async function fetchEditorPick(cityId) {
  const { data, error } = await supabase
    .from('editor_picks')
    .select('*')
    .eq('city_id', cityId)
    .eq('active', true)
    .maybeSingle();
  if (error) return null; // table optional / non-fatal
  if (!data) return null;
  return {
    cityId: data.city_id,
    title: data.title || '',
    note: data.note || '',
    detail: data.detail || '',
    linkUrl: data.link_url || null,
  };
}

export async function saveEditorPick(cityId, { title, note, detail, linkUrl }) {
  const { error } = await supabase.from('editor_picks').upsert(
    { city_id: cityId, title, note, detail, link_url: linkUrl || null, active: true, updated_at: new Date().toISOString() },
    { onConflict: 'city_id' }
  );
  if (error) throw error;
}

export async function clearEditorPick(cityId) {
  const { error } = await supabase.from('editor_picks').delete().eq('city_id', cityId);
  if (error) throw error;
}

export async function fetchGarageSales(cityId) {
  const rows = [];
  for (let from = 0; ; from += 1000) { // paginate past PostgREST's 1000-row cap
    const { data, error } = await supabase
      .from('garage_sales')
      .select('*')
      .eq('city_id', cityId)
      .eq('status', 'approved')
      .order('featured', { ascending: false })
      .order('start_date', { ascending: true })
      .order('id', { ascending: true }) // unique tiebreaker so pages don't dupe/drop rows
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  // Drop sales that have already ended (no date filter exists in the query),
  // including a final day whose posted daily end time has passed.
  const today = todayKeyET();
  return rows
    .filter((r) => {
      const last = r.end_date || r.start_date || today;
      if (last > today) return true;
      if (last < today) return false;
      const endMin = clockMinutes(r.daily_end);
      return endMin == null || nowMinutesET() <= endMin;
    })
    .map(rowToSale);
}

export async function fetchFoodTrucks(cityId) {
  const rows = [];
  for (let from = 0; ; from += 1000) { // paginate past PostgREST's 1000-row cap
    const { data, error } = await supabase
      .from('food_trucks')
      .select('*')
      .eq('city_id', cityId)
      .eq('status', 'approved')
      .order('featured', { ascending: false })
      .order('date', { ascending: true })
      .order('id', { ascending: true }) // unique tiebreaker so pages don't dupe/drop rows
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  // Drop food trucks whose date has passed, and today's stops once their posted
  // end time is behind us (they used to show TODAY until midnight).
  const today = todayKeyET();
  return rows
    .filter((r) => {
      const day = r.date || today;
      if (day > today) return true;
      if (day < today) return false;
      const endMin = clockMinutes(r.end_time);
      return endMin == null || nowMinutesET() <= endMin;
    })
    .map(rowToTruck);
}

// ---- Writes (RLS forces status='pending' and stamps created_by) ----

export async function insertEvent(event) {
  const { data, error } = await supabase
    .from('events')
    .insert(eventToRow(event))
    .select()
    .single();
  if (error) throw error;
  return rowToEvent(data);
}

// Admin-only field edit (RLS: the events_update policy is is_admin(), so the
// server rejects this for anyone else regardless of what the client sends).
// Only the content fields are patchable — status/featured/created_by stay put.
// Owner edit. Goes through update_own_event, which verifies created_by =
// auth.uid(), refuses aggregator rows, ignores status/featured entirely, and
// returns the row to 'pending' for re-moderation. A plain .update() would be
// rejected by RLS (admin-only) — that is deliberate.
export async function updateOwnEvent(id, patch) {
  const { data, error } = await supabase.rpc('update_own_event', {
    p_id: id,
    p_title: patch.title,
    p_category: patch.category,
    p_start_at: patch.start,
    p_end_at: patch.end || null,
    p_venue: patch.venue || '',
    p_address: patch.address || '',
    p_price: patch.price || '',
    p_description: patch.description || '',
    p_image_url: patch.imageUrl || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? rowToEvent(data[0]) : rowToEvent(data);
}

// Owner edits for the other two listing types. Same contract as
// updateOwnEvent: ownership checked server-side, status/featured untouchable,
// row re-pends for review. Photos are not editable here yet.
export async function updateOwnGarageSale(id, patch) {
  const { data, error } = await supabase.rpc('update_own_garage_sale', {
    p_id: id,
    p_title: patch.title,
    p_type: patch.type,
    p_start_date: patch.start,
    p_end_date: patch.end || null,
    p_daily_start: patch.dailyStart || '',
    p_daily_end: patch.dailyEnd || '',
    p_address: patch.address,
    p_neighborhood: patch.neighborhood || '',
    p_note: patch.note || '',
    p_items: Array.isArray(patch.items) ? patch.items : null,
  });
  if (error) throw error;
  return rowToSale(Array.isArray(data) ? data[0] : data);
}

export async function updateOwnFoodTruck(id, patch) {
  const { data, error } = await supabase.rpc('update_own_food_truck', {
    p_id: id,
    p_name: patch.name,
    p_cuisine: patch.cuisine,
    p_date: patch.date,
    p_start_time: patch.startTime || '',
    p_end_time: patch.endTime || '',
    p_location_name: patch.locationName || '',
    p_address: patch.address || '',
    p_note: patch.note || '',
  });
  if (error) throw error;
  return rowToTruck(Array.isArray(data) ? data[0] : data);
}

export async function updateEvent(id, patch) {
  const row = {
    title: patch.title,
    category: patch.category,
    emoji: patch.emoji,
    start_at: patch.start,
    end_at: patch.end,
    venue: patch.venue,
    address: patch.address,
    price: patch.price,
    description: patch.description,
  };
  // When the location changed, clear the coordinates: the nightly geocoder only
  // fills NULL lat/lng, so keeping the old values would pin the map at the OLD
  // address forever while the detail screen shows the new one.
  if (patch.clearCoords) { row.lat = null; row.lng = null; }
  const { data, error } = await supabase
    .from('events')
    .update(row)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return rowToEvent(data);
}

export async function insertGarageSale(sale) {
  const { data, error } = await supabase
    .from('garage_sales')
    .insert(saleToRow(sale))
    .select()
    .single();
  if (error) throw error;
  return rowToSale(data);
}

// Self-serve calendar intake: a truck owner registers their Google Calendar /
// iCal link ONCE and their stops auto-appear. Goes through a SECURITY DEFINER RPC
// into a PENDING queue (an admin approves before it ever auto-pulls) — the
// truck_calendars table itself stays locked to the service role.
export async function submitTruckCalendar({ name, cityId, cuisine, icalUrl, contact }) {
  const { error } = await supabase.rpc('submit_truck_calendar', {
    p_name: name,
    p_city: cityId,
    p_cuisine: cuisine || 'Food truck',
    p_ical_url: icalUrl,
    p_contact: contact || '',
  });
  if (error) throw error;
}

// Self-serve EVENT calendar intake: an organizer registers a Google / iCal link
// ONCE and their events auto-appear after admin review. Same shape as the truck
// intake: a SECURITY DEFINER RPC drops a PENDING, disabled event_sources row that
// the aggregator only pulls once approved (see supabase/event_source_intake.sql).
export async function submitEventSource({ name, cityId, url, category, contact }) {
  const { error } = await supabase.rpc('submit_event_source', {
    p_name: name,
    p_city: cityId,
    p_url: url,
    p_category: category || 'Community',
    p_contact: contact || '',
  });
  if (error) throw error;
}

// Admin: list pending self-serve event-calendar submissions. event_sources is
// service-role locked, so these go through is_admin()-gated SECURITY DEFINER RPCs.
export async function fetchPendingCalendars() {
  const { data, error } = await supabase.rpc('admin_pending_event_sources');
  if (error) throw error;
  return data || [];
}
// Admin: approve (enable + start pulling) or reject (delete) a pending calendar.
export async function setCalendarStatus(id, approve) {
  const { error } = await supabase.rpc('admin_set_event_source', { p_id: id, p_approve: approve });
  if (error) throw error;
}

export async function insertFoodTruck(truck) {
  const { data, error } = await supabase
    .from('food_trucks')
    .insert(truckToRow(truck))
    .select()
    .single();
  if (error) throw error;
  return rowToTruck(data);
}

// Fetch specific events by id (for the Saved list — saved events can be in any city).
export async function fetchEventsByIds(ids) {
  if (!ids || !ids.length) return [];
  const { data, error } = await supabase.from('events').select('*').in('id', ids);
  if (error) throw error;
  return (data || []).map(rowToEvent);
}

// Fetch specific garage sales by id (for the Saved list — can be in any city).
export async function fetchGarageSalesByIds(ids) {
  if (!ids || !ids.length) return [];
  const { data, error } = await supabase.from('garage_sales').select('*').in('id', ids);
  if (error) throw error;
  return (data || []).map(rowToSale);
}

// Total upcoming approved events across every town — the welcome-screen stat.
export async function fetchUpcomingEventCount() {
  const { count, error } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'approved')
    .gte('start_at', new Date().toISOString());
  if (error) throw error;
  return count || 0;
}

// Listings that have been reported, grouped, with the listing details + reasons.
export async function fetchReported() {
  // Paginate past PostgREST's 1000-row cap so a backlog of reports can't silently
  // hide the older tail of the moderation queue (id tiebreaker keeps pages stable).
  const reps = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('reports')
      .select('kind, listing_id, reason, created_at')
      .order('created_at', { ascending: false })
      .order('listing_id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    reps.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  if (!reps.length) return [];

  const groups = {};
  for (const r of reps) {
    const key = `${r.kind}:${r.listing_id}`;
    if (!groups[key]) groups[key] = { kind: r.kind, id: r.listing_id, reportCount: 0, reasons: [] };
    groups[key].reportCount += 1;
    if (r.reason && !groups[key].reasons.includes(r.reason)) groups[key].reasons.push(r.reason);
  }

  const byKind = { event: [], garage_sale: [], food_truck: [] };
  Object.values(groups).forEach((g) => byKind[g.kind] && byKind[g.kind].push(g.id));
  const q = (table, ids) =>
    ids.length ? supabase.from(table).select('*').in('id', ids) : Promise.resolve({ data: [] });
  const [ev, gs, ft] = await Promise.all([
    q('events', byKind.event),
    q('garage_sales', byKind.garage_sale),
    q('food_trucks', byKind.food_truck),
  ]);
  const map = {};
  (ev.data || []).forEach((r) => (map[`event:${r.id}`] = { kind: 'event', ...rowToEvent(r) }));
  (gs.data || []).forEach((r) => (map[`garage_sale:${r.id}`] = { kind: 'garage_sale', ...rowToSale(r) }));
  (ft.data || []).forEach((r) => (map[`food_truck:${r.id}`] = { kind: 'food_truck', ...rowToTruck(r) }));

  return Object.values(groups)
    .map((g) => {
      const listing = map[`${g.kind}:${g.id}`];
      return listing ? { ...listing, reportCount: g.reportCount, reasons: g.reasons } : null;
    })
    .filter(Boolean);
}

// Clear the reports on a listing (when you decide to keep it).
export async function dismissReports(kind, id) {
  const { error } = await supabase.from('reports').delete().eq('kind', kind).eq('listing_id', id);
  if (error) throw error;
}

// Count a view of a listing (fire-and-forget). kind: 'event' | 'garage_sale' | 'food_truck'.
export async function recordView(kind, id) {
  try {
    await supabase.rpc('bump_view', { p_kind: kind, p_id: id });
  } catch (e) {
    // non-fatal — analytics shouldn't break the page
  }
}

// Flag a listing for review. kind: 'event' | 'garage_sale' | 'food_truck'.
export async function insertReport(kind, listingId, reason = '') {
  const { error } = await supabase
    .from('reports')
    .insert({ kind, listing_id: listingId, reason });
  if (error) throw error;
}

// ---- Admin moderation (requires is_admin() in the database) ----

const TABLE_BY_KIND = {
  event: 'events',
  garage_sale: 'garage_sales',
  food_truck: 'food_trucks',
};

// All pending submissions across the three types, newest first, tagged by kind.
export async function fetchPending() {
  const [ev, gs, ft] = await Promise.all([
    supabase.from('events').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
    supabase.from('garage_sales').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
    supabase.from('food_trucks').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
  ]);
  const out = [];
  (ev.data || []).forEach((r) => out.push({ kind: 'event', ...rowToEvent(r) }));
  (gs.data || []).forEach((r) => out.push({ kind: 'garage_sale', ...rowToSale(r) }));
  (ft.data || []).forEach((r) => out.push({ kind: 'food_truck', ...rowToTruck(r) }));
  return out;
}

// Count of pending items (for the badge), cheap head queries.
export async function fetchPendingCount() {
  const tables = ['events', 'garage_sales', 'food_trucks'];
  const results = await Promise.all(
    tables.map((t) =>
      supabase.from(t).select('id', { count: 'exact', head: true }).eq('status', 'pending')
    )
  );
  return results.reduce((sum, r) => sum + (r.count || 0), 0);
}

// Approve or reject a post. status: 'approved' | 'rejected'.
export async function setPostStatus(kind, id, status) {
  const table = TABLE_BY_KIND[kind];
  if (!table) throw new Error('Unknown listing type');
  const { error } = await supabase.from(table).update({ status }).eq('id', id);
  if (error) throw error;
}

// Feature a listing until a date (admin only — enforced by set_featured()).
// Pass days = 0 to remove the feature.
export async function setFeatured(kind, id, days) {
  const until = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
  const { error } = await supabase.rpc('set_featured', { p_kind: kind, p_id: id, p_until: until });
  if (error) throw error;
  return until;
}

// ---- Sponsors / ads ----

function rowToSponsor(r) {
  return {
    id: r.id,
    cityId: r.city_id,
    title: r.title,
    body: r.body,
    imageUrl: r.image_url,
    linkUrl: r.link_url,
    weight: r.weight,
    active: r.active,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    impressions: r.impressions ?? 0,
    clicks: r.clicks ?? 0,
  };
}

// Count an ad impression or tap (fire-and-forget). event: 'impression' | 'click'.
export async function trackSponsor(id, event) {
  try {
    await supabase.rpc('track_sponsor', { p_id: id, p_event: event });
  } catch (e) {
    // non-fatal — ad analytics shouldn't break the UI
  }
}

// ---- Local Deals ----

function rowToDeal(r) {
  return {
    id: r.id,
    cityId: r.city_id,
    businessName: r.business_name || 'Local business',
    title: r.title || 'Local deal',
    description: r.description || '',
    address: r.address,
    linkUrl: r.link_url,
    imageUrl: r.image_url,
    active: r.active,
    featured: r.featured,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    viewCount: r.view_count ?? 0,
  };
}

// Explicit display columns — never select('*'), so deals_hardening.sql can revoke
// anon access to the Stripe id columns without 401-ing these reads.
const DEAL_COLS = 'id, city_id, business_name, title, description, address, link_url, image_url, active, featured, starts_at, ends_at, view_count, created_at';

// Live deals for a town (newest/featured first).
export async function fetchDeals(cityId) {
  const { data, error } = await supabase
    .from('deals')
    .select(DEAL_COLS)
    .eq('city_id', cityId)
    .eq('active', true)
    .order('featured', { ascending: false })
    .order('created_at', { ascending: false });
  // Degrade to empty rather than crash the Deals screen (e.g. a brief grant skew
  // between the hardening migration and OTA saturation).
  if (error) { console.warn('fetchDeals failed:', error.message); return []; }
  const now = Date.now();
  return (data || [])
    .filter((r) => (!r.starts_at || Date.parse(r.starts_at) <= now) && (!r.ends_at || Date.parse(r.ends_at) >= now))
    .map(rowToDeal);
}

// Admin: every deal regardless of state.
export async function fetchAllDeals() {
  const { data, error } = await supabase.from('deals').select(DEAL_COLS).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToDeal);
}

export async function insertDeal(d) {
  const { data, error } = await supabase
    .from('deals')
    .insert({
      city_id: d.cityId,
      business_name: d.businessName,
      title: d.title,
      description: d.description || null,
      address: d.address || null,
      link_url: d.linkUrl || null,
      image_url: d.imageUrl || null,
      active: d.active !== false,
      featured: d.featured || false,
      starts_at: d.startsAt || null,
      ends_at: d.endsAt || null,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToDeal(data);
}

export async function setDealActive(id, active) {
  // Mirror setSponsorActive: turning ON clears a stale payment_failed pause (else the
  // invoice.paid webhook, which reactivates WHERE paused_reason='payment_failed',
  // could later resurrect a deal the moderator deliberately disabled) and any
  // already-passed end date (which RLS would otherwise keep hidden).
  const patch = active ? { active: true, paused_reason: null } : { active: false };
  const { error } = await supabase.from('deals').update(patch).eq('id', id);
  if (error) throw error;
  if (active) {
    await supabase.from('deals').update({ ends_at: null }).eq('id', id).lt('ends_at', new Date().toISOString());
  }
}

export async function deleteDeal(id) {
  const { error } = await supabase.from('deals').delete().eq('id', id);
  if (error) throw error;
}

export async function recordDealView(id) {
  try {
    await supabase.rpc('bump_deal_view', { p_id: id });
  } catch (e) {
    // non-fatal
  }
}

// Permanently delete the signed-in user's account + the content they submitted.
// Runs server-side via a SECURITY DEFINER function scoped to auth.uid(), so a
// user can only ever delete themselves. See supabase/account_deletion.sql.
export async function deleteAccountRpc() {
  const { error } = await supabase.rpc('delete_account');
  if (error) throw error;
}

// Register/refresh a device's push token (for the weekend digest). Goes through a
// SECURITY DEFINER function so the table needs no anon write policy — a direct
// upsert with an open anon UPDATE policy would let anyone overwrite other devices'
// token rows. See supabase/push.sql / supabase/launch_audit_fixes.sql.
export async function savePushToken(token, cityId, platform, interests) {
  try {
    await supabase.rpc('register_push_token', {
      p_token: token,
      p_city: cityId,
      p_platform: platform,
      p_interests: interests && interests.length ? interests : null,
    });
  } catch (e) {
    // non-fatal
  }
}

// A town's total reach (sum of listing views).
export async function fetchCityReach(cityId) {
  try {
    const { data, error } = await supabase.rpc('city_reach', { p_city: cityId });
    if (error) throw error;
    return data || 0;
  } catch (e) {
    return 0;
  }
}

// Record that this device is active in a town (anonymous; powers user-based ad
// pricing). Fire-and-forget.
export async function recordDeviceActivity(deviceId, cityId, platform) {
  try {
    // Via a SECURITY DEFINER function so the table stays fully private (no anon
    // read/write policies). A direct upsert needs read access for ON CONFLICT,
    // which would expose the user list. See supabase/device_activity.sql.
    // p_platform ('ios' | 'android') powers the iOS-vs-Android metrics breakout.
    await supabase.rpc('record_device_activity', { p_device: deviceId, p_city: cityId, p_platform: platform });
  } catch (e) {
    // non-fatal
  }
}

// Events with coordinates inside a map viewport — ANY town. Powers the map's
// zoom-out discovery: it opens framed on your town, and panning/zooming fetches
// whatever else lives in the visible area, so neighboring towns' events appear
// as you widen. Small projection, capped, soonest-first.
export async function fetchEventsInBounds({ w, s, e, n }, limit = 250) {
  try {
    // Current or upcoming only: a real end still ahead, or (no end) started
    // within the last 3 hours. The old start-only 12h window pinned events that
    // ended hours ago while HIDING still-running multi-day festivals entirely.
    const nowIso = new Date().toISOString();
    const graceIso = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const { data, error } = await supabase
      .from('events')
      .select('id, title, lat, lng, category')
      .eq('status', 'approved')
      .or(`end_at.gte.${nowIso},and(end_at.is.null,start_at.gte.${graceIso})`)
      .not('lat', 'is', null)
      .gte('lat', s)
      .lte('lat', n)
      .gte('lng', w)
      .lte('lng', e)
      .order('start_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return data || [];
  } catch (err) {
    return [];
  }
}

// Town ids the aggregator currently has upcoming events for. The picker shows only
// these (+ the user's current selection) so an empty "ghost" town is never shown,
// and a town reappears the moment the daily aggregator finds it an event. Returns
// null on any error so the picker can fall back to showing every town.
export async function fetchActiveCities() {
  try {
    const { data, error } = await supabase.rpc('active_cities');
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return null;
  }
}

// Per-town upcoming-event counts for the picker, so a user sees which towns are
// dense vs just getting started. Additive + fail-safe: returns {} on any error so
// the picker still renders its town list (which comes from active_cities()).
export async function fetchActiveCityCounts() {
  try {
    const { data, error } = await supabase.rpc('active_city_counts');
    if (error) throw error;
    const map = {};
    for (const r of data || []) map[r.city_id] = r.n;
    return map;
  } catch (e) {
    return {};
  }
}

// App-wide runtime config — currently the cross-platform update-prompt version gate
// ({ ios:{latest,min,url}, android:{...} }). Public row; returns null on any error so
// the update prompt simply stays quiet rather than surfacing a failure.
export async function fetchVersionGate() {
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'version')
      .maybeSingle();
    if (error) throw error;
    return data?.value || null;
  } catch (e) {
    return null;
  }
}

// Distinct devices per platform (ios / android / unknown) over the last 30 days,
// for the admin metrics screen. p_city null = all towns. Reads via a SECURITY
// DEFINER RPC so device_activity stays private. See supabase/device_platform.sql.
export async function fetchPlatformSplit(cityId) {
  try {
    const { data, error } =
      cityId == null
        ? await supabase.rpc('platform_split')
        : await supabase.rpc('platform_split', { p_city: cityId });
    if (error) throw error;
    const out = { ios: 0, android: 0, web: 0, unknown: 0 };
    for (const r of data || []) {
      // Web (localloop.io) is a real platform now, not "unknown" — break it out.
      // Only legacy rows with no recorded platform fall into unknown.
      const key = ['ios', 'android', 'web'].includes(r.platform) ? r.platform : 'unknown';
      out[key] += r.users || 0;
    }
    return out;
  } catch (e) {
    return { ios: 0, android: 0, web: 0, unknown: 0 };
  }
}

// Monthly active users in a town — drives ad pricing by actual users.
// Pass null or 'all' to count active users across every town.
export async function fetchCityUsers(cityId) {
  try {
    const all = !cityId || cityId === 'all';
    const { data, error } = all
      ? await supabase.rpc('all_active_users')
      : await supabase.rpc('city_active_users', { p_city: cityId });
    if (error) throw error;
    return data || 0;
  } catch (e) {
    // null = UNKNOWN, distinct from a real 0 — callers must never price a tier
    // off a failed fetch (rateForUsers(0) = Founding would undercharge).
    return null;
  }
}

// Columns the anon role may read (see supabase/sponsors_hardening.sql — Stripe
// ids and metrics are column-restricted, so `select *` would be denied).
const SPONSOR_PUBLIC_COLS = 'id, city_id, title, body, image_url, link_url, weight, active, starts_at, ends_at';

// Live ads for a city (RLS already restricts to active + in-window for non-admins).
export async function fetchSponsors(cityId) {
  const { data, error } = await supabase
    .from('sponsors')
    .select(SPONSOR_PUBLIC_COLS)
    .eq('city_id', cityId)
    .eq('active', true)
    .order('weight', { ascending: false });
  if (error) throw error;
  // Belt-and-suspenders: also drop anything outside its date window client-side.
  const now = Date.now();
  return (data || [])
    .filter((r) => (!r.starts_at || Date.parse(r.starts_at) <= now) && (!r.ends_at || Date.parse(r.ends_at) >= now))
    .map(rowToSponsor);
}

// Admin: every ad regardless of state (for the manager screen).
export async function fetchAllSponsors() {
  const { data, error } = await supabase
    .from('sponsors')
    .select(`${SPONSOR_PUBLIC_COLS}, created_at, impressions, clicks, product, paused_reason`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToSponsor);
}

export async function insertSponsor(s) {
  const { data, error } = await supabase
    .from('sponsors')
    .insert({
      city_id: s.cityId,
      title: s.title,
      body: s.body || null,
      image_url: s.imageUrl || null,
      link_url: s.linkUrl || null,
      weight: s.weight || 1,
      active: s.active !== false,
      starts_at: s.startsAt || null,
      ends_at: s.endsAt || null,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToSponsor(data);
}

export async function setSponsorActive(id, active) {
  // Turning ON clears the pause reason (manual owner intent overrides an old
  // payment_failed flag) AND any already-passed end date — without that, the
  // toggle showed "on" while RLS hid the ad and expire_promotions flipped it
  // straight back off.
  const patch = active ? { active: true, paused_reason: null } : { active: false };
  const { error } = await supabase.from('sponsors').update(patch).eq('id', id);
  if (error) throw error;
  if (active) {
    await supabase
      .from('sponsors')
      .update({ ends_at: null })
      .eq('id', id)
      .lt('ends_at', new Date().toISOString());
  }
}

export async function deleteSponsor(id) {
  const { error } = await supabase.from('sponsors').delete().eq('id', id);
  if (error) throw error;
}

// Flip off any expired promotions/ads (idempotent, safe to fire-and-forget).
export async function expirePromotions() {
  try {
    await supabase.rpc('expire_promotions');
  } catch (e) {
    // non-fatal
  }
}

// ---- Admin metrics (reach numbers to show advertisers) ----

// Reach snapshot for one city, or across every town when cityId is null/'all':
// live listing counts, total views per type, the most-viewed listings, and how
// many active ads / featured listings are running.
export async function fetchMetrics(cityId) {
  const all = !cityId || cityId === 'all';

  // Pull every matching row, paging past PostgREST's 1000-row cap — all-town
  // totals span thousands of listings, so a single select would truncate them.
  const pull = async (table, cols) => {
    const out = [];
    let from = 0;
    let page;
    do {
      let q = supabase.from(table).select(cols).eq('status', 'approved');
      if (!all) q = q.eq('city_id', cityId);
      const { data } = await q.range(from, from + 999);
      page = data || [];
      out.push(...page);
      from += 1000;
    } while (page.length === 1000);
    return out;
  };
  const pullSponsors = async () => {
    let q = supabase.from('sponsors').select('id,title,city_id,active,link_url');
    if (!all) q = q.eq('city_id', cityId);
    const { data } = await q;
    return data || [];
  };

  const [evRows, gsRows, ftRows, spRows] = await Promise.all([
    pull('events', 'id,title,view_count,featured,featured_until,city_id'),
    pull('garage_sales', 'id,title,view_count,featured,featured_until,city_id,start_date,end_date,created_by'),
    pull('food_trucks', 'id,name,view_count,featured,featured_until,city_id,date,created_by,source_uid'),
    pullSponsors(),
  ]);
  const sumViews = (rows) => rows.reduce((n, r) => n + (r.view_count || 0), 0);

  const top = [
    ...evRows.map((r) => ({ kind: 'event', id: r.id, title: r.title, views: r.view_count || 0, cityId: r.city_id })),
    ...gsRows.map((r) => ({ kind: 'garage_sale', id: r.id, title: r.title, views: r.view_count || 0, cityId: r.city_id })),
    ...ftRows.map((r) => ({ kind: 'food_truck', id: r.id, title: r.name, views: r.view_count || 0, cityId: r.city_id })),
  ]
    .sort((a, b) => b.views - a.views)
    .slice(0, 8);

  return {
    counts: { event: evRows.length, garage_sale: gsRows.length, food_truck: ftRows.length },
    views: { event: sumViews(evRows), garage_sale: sumViews(gsRows), food_truck: sumViews(ftRows) },
    totalViews: sumViews(evRows) + sumViews(gsRows) + sumViews(ftRows),
    totalListings: evRows.length + gsRows.length + ftRows.length,
    // Match the live public gating (isFeatured checks featured_until), so the
    // metrics tile can't over-count a promotion whose paid window already lapsed
    // but whose boolean the daily expire job hasn't flipped off yet.
    featuredCount:
      evRows.filter(isFeatured).length +
      gsRows.filter(isFeatured).length +
      ftRows.filter(isFeatured).length,
    activeAds: spRows.filter((r) => r.active).length,
    totalAds: spRows.length,
    // The actual items behind the "Featured now" / "Active ads" tiles, so the
    // metrics screen can expand them into a tappable list.
    featuredItems: [
      ...evRows.filter(isFeatured).map((r) => ({ kind: 'event', id: r.id, title: r.title })),
      ...gsRows.filter(isFeatured).map((r) => ({ kind: 'garage_sale', id: r.id, title: r.title })),
      ...ftRows.filter(isFeatured).map((r) => ({ kind: 'food_truck', id: r.id, title: r.name })),
    ],
    adItems: spRows
      .filter((r) => r.active)
      .map((r) => ({ id: r.id, title: r.title, city_id: r.city_id, link_url: r.link_url })),
    // Every live garage sale / food truck with where-it-came-from, so the
    // metrics rows can expand into an inspectable list. Events are omitted —
    // thousands of aggregator rows would bloat the payload for no admin value.
    // source: 'feed' = aggregator/calendar ingest, 'user' = a signed-in poster,
    // 'anon' = no account attached (usually an owner/test insert).
    listItems: {
      garage_sale: gsRows.map((r) => ({
        id: r.id,
        title: r.title,
        city_id: r.city_id,
        when: r.start_date,
        ended: r.end_date ? r.end_date < new Date().toISOString().slice(0, 10) : false,
        source: r.created_by ? 'user' : 'anon',
      })),
      food_truck: ftRows.map((r) => ({
        id: r.id,
        title: r.name,
        city_id: r.city_id,
        when: r.date,
        ended: r.date ? r.date < new Date().toISOString().slice(0, 10) : false,
        source: r.source_uid ? 'feed' : r.created_by ? 'user' : 'anon',
      })),
    },
    top,
  };
}

// ============ Social layer (follows / RSVP / claims) — Jul 2026 ============
// All device-scoped writes go through the SECURITY DEFINER RPCs in
// supabase/social_layer_2026_07.sql. Every call fails soft (returns a neutral
// value) so a network blip never breaks a tap.

// #1 Follow a truck by name. Returns the new state (true = now following).
export async function toggleTruckFollow(deviceId, truckName, cityId, pushToken) {
  try {
    const { data, error } = await supabase.rpc('toggle_truck_follow', {
      p_device: deviceId, p_name: truckName, p_city: cityId || null, p_token: pushToken || null,
    });
    if (error) throw error;
    return Boolean(data);
  } catch { return null; }
}

export async function fetchMyTruckFollows(deviceId) {
  try {
    const { data, error } = await supabase.rpc('my_truck_follows', { p_device: deviceId });
    if (error) throw error;
    return (data || []).map((r) => r.truck_name);
  } catch { return []; }
}

export async function fetchTruckFollowerCount(name, cityId) {
  try {
    const { data, error } = await supabase.rpc('truck_follower_count', { p_name: name, p_city: cityId || null });
    if (error) throw error;
    return data || 0;
  } catch { return 0; }
}

// #4 RSVP toggle — returns the fresh count, or null on failure.
export async function toggleRsvp(kind, listingId, deviceId) {
  try {
    const { data, error } = await supabase.rpc('toggle_rsvp', { p_kind: kind, p_id: listingId, p_device: deviceId });
    if (error) throw error;
    return typeof data === 'number' ? data : null;
  } catch { return null; }
}

// Batch: {id: {n, mine}} for a feed's worth of listings.
export async function fetchRsvpCounts(kind, ids, deviceId) {
  try {
    if (!ids?.length) return {};
    const { data, error } = await supabase.rpc('rsvp_counts', { p_kind: kind, p_ids: ids, p_device: deviceId || null });
    if (error) throw error;
    return Object.fromEntries((data || []).map((r) => [r.listing_id, { n: r.n, mine: r.mine }]));
  } catch { return {}; }
}

// #7 Submit a business/listing claim. Returns the claim id or throws (the form
// surfaces the message).
export async function submitBusinessClaim({ name, cityId, kind, contactName, email, phone, note, deviceId }) {
  const { data, error } = await supabase.rpc('submit_business_claim', {
    p_name: name, p_city: cityId || null, p_kind: kind || null, p_contact_name: contactName || null,
    p_email: email, p_phone: phone || null, p_note: note || null, p_device: deviceId || null,
  });
  if (error) throw new Error(error.message || 'Could not submit your claim.');
  return data;
}
