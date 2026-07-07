import { supabase } from './supabase';
import { cleanText, cleanLocation, cleanDescription } from './text';
import { effectiveEndMs } from './eventTime';

// Today's date in Eastern time as 'YYYY-MM-DD' (date-only strings sort
// chronologically), used to expire past garage sales and food trucks.
function todayKeyET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
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
    pending: r.status !== 'approved',
    note: cleanDescription(r.note),
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
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('city_id', cityId)
    .eq('status', 'approved')
    .or(`start_at.gte.${cutoff},end_at.gte.${nowIso}`)
    .order('featured', { ascending: false })
    .order('start_at', { ascending: true });
  if (error) throw error;
  // Drop events that have already ended — by their real end time, or an estimate
  // for the ~6% of feeds that omit one — so a noon event doesn't sit on "today"
  // until midnight. Upcoming and still-running events are kept.
  const now = Date.now();
  return (data || [])
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
  const { data, error } = await supabase
    .from('garage_sales')
    .select('*')
    .eq('city_id', cityId)
    .eq('status', 'approved')
    .order('featured', { ascending: false })
    .order('start_date', { ascending: true });
  if (error) throw error;
  // Drop sales that have already ended (no date filter exists in the query).
  const today = todayKeyET();
  return (data || [])
    .filter((r) => (r.end_date || r.start_date || today) >= today)
    .map(rowToSale);
}

export async function fetchFoodTrucks(cityId) {
  const { data, error } = await supabase
    .from('food_trucks')
    .select('*')
    .eq('city_id', cityId)
    .eq('status', 'approved')
    .order('featured', { ascending: false })
    .order('date', { ascending: true });
  if (error) throw error;
  // Drop food trucks whose date has passed (no date filter exists in the query).
  const today = todayKeyET();
  return (data || []).filter((r) => (r.date || today) >= today).map(rowToTruck);
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

export async function insertGarageSale(sale) {
  const { data, error } = await supabase
    .from('garage_sales')
    .insert(saleToRow(sale))
    .select()
    .single();
  if (error) throw error;
  return rowToSale(data);
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

// Listings that have been reported, grouped, with the listing details + reasons.
export async function fetchReported() {
  const { data: reps, error } = await supabase
    .from('reports')
    .select('kind, listing_id, reason, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (!reps || !reps.length) return [];

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

// Live deals for a town (newest/featured first).
export async function fetchDeals(cityId) {
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .eq('city_id', cityId)
    .eq('active', true)
    .order('featured', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  const now = Date.now();
  return (data || [])
    .filter((r) => (!r.starts_at || Date.parse(r.starts_at) <= now) && (!r.ends_at || Date.parse(r.ends_at) >= now))
    .map(rowToDeal);
}

// Admin: every deal regardless of state.
export async function fetchAllDeals() {
  const { data, error } = await supabase.from('deals').select('*').order('created_at', { ascending: false });
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
  const { error } = await supabase.from('deals').update({ active }).eq('id', id);
  if (error) throw error;
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
export async function savePushToken(token, cityId, platform) {
  try {
    await supabase.rpc('register_push_token', { p_token: token, p_city: cityId, p_platform: platform });
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
export async function recordDeviceActivity(deviceId, cityId) {
  try {
    // Via a SECURITY DEFINER function so the table stays fully private (no anon
    // read/write policies). A direct upsert needs read access for ON CONFLICT,
    // which would expose the user list. See supabase/device_activity.sql.
    await supabase.rpc('record_device_activity', { p_device: deviceId, p_city: cityId });
  } catch (e) {
    // non-fatal
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
    return 0;
  }
}

// Live ads for a city (RLS already restricts to active + in-window for non-admins).
export async function fetchSponsors(cityId) {
  const { data, error } = await supabase
    .from('sponsors')
    .select('*')
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
    .select('*')
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
  const { error } = await supabase.from('sponsors').update({ active }).eq('id', id);
  if (error) throw error;
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
    let q = supabase.from('sponsors').select('id,active');
    if (!all) q = q.eq('city_id', cityId);
    const { data } = await q;
    return data || [];
  };

  const [evRows, gsRows, ftRows, spRows] = await Promise.all([
    pull('events', 'id,title,view_count,featured'),
    pull('garage_sales', 'id,title,view_count,featured'),
    pull('food_trucks', 'id,name,view_count,featured'),
    pullSponsors(),
  ]);
  const sumViews = (rows) => rows.reduce((n, r) => n + (r.view_count || 0), 0);

  const top = [
    ...evRows.map((r) => ({ kind: 'event', id: r.id, title: r.title, views: r.view_count || 0 })),
    ...gsRows.map((r) => ({ kind: 'garage_sale', id: r.id, title: r.title, views: r.view_count || 0 })),
    ...ftRows.map((r) => ({ kind: 'food_truck', id: r.id, title: r.name, views: r.view_count || 0 })),
  ]
    .sort((a, b) => b.views - a.views)
    .slice(0, 8);

  return {
    counts: { event: evRows.length, garage_sale: gsRows.length, food_truck: ftRows.length },
    views: { event: sumViews(evRows), garage_sale: sumViews(gsRows), food_truck: sumViews(ftRows) },
    totalViews: sumViews(evRows) + sumViews(gsRows) + sumViews(ftRows),
    totalListings: evRows.length + gsRows.length + ftRows.length,
    featuredCount:
      evRows.filter((r) => r.featured).length +
      gsRows.filter((r) => r.featured).length +
      ftRows.filter((r) => r.featured).length,
    activeAds: spRows.filter((r) => r.active).length,
    totalAds: spRows.length,
    top,
  };
}
