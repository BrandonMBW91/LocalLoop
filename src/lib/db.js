import { supabase } from './supabase';

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
    title: r.title || 'Untitled event',
    category: r.category || 'Community',
    emoji: r.emoji,
    start: r.start_at,
    end: r.end_at,
    venue: r.venue || '',
    address: r.address || '',
    price: r.price || 'See details',
    host: r.host || 'Community submission',
    featured: isFeatured(r),
    featuredUntil: r.featured_until,
    viewCount: r.view_count,
    lat: r.lat,
    lng: r.lng,
    imageUrl: r.image_url || null,
    ticketUrl: r.ticket_url || null,
    pending: r.status !== 'approved',
    description: r.description || '',
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
    title: r.title || 'Garage sale',
    type: r.type || 'Garage Sale',
    start: r.start_date,
    end: r.end_date,
    dailyStart: r.daily_start,
    dailyEnd: r.daily_end,
    address: r.address || '',
    neighborhood: r.neighborhood || '',
    items: r.items || [],
    images: r.images || [],
    featured: isFeatured(r),
    featuredUntil: r.featured_until,
    viewCount: r.view_count,
    host: r.host || 'Community submission',
    pending: r.status !== 'approved',
    note: r.note || '',
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
    name: r.name || 'Food truck',
    cuisine: r.cuisine || 'Other',
    date: r.date,
    startTime: r.start_time || '',
    endTime: r.end_time || '',
    locationName: r.location_name || '',
    address: r.address || '',
    featured: isFeatured(r),
    featuredUntil: r.featured_until,
    viewCount: r.view_count,
    host: r.host || 'Community submission',
    pending: r.status !== 'approved',
    note: r.note || '',
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
    const path = `${Date.now()}-${i}.jpg`;
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
  // Hide events that already happened (keep ones that started earlier today).
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('city_id', cityId)
    .eq('status', 'approved')
    .gte('start_at', cutoff)
    .order('featured', { ascending: false })
    .order('start_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToEvent);
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
  return (data || []).map(rowToSale);
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
  return (data || []).map(rowToTruck);
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

// Register/refresh a device's push token (for the weekend digest).
export async function savePushToken(token, cityId, platform) {
  try {
    await supabase
      .from('push_tokens')
      .upsert({ token, city_id: cityId, platform, updated_at: new Date().toISOString() }, { onConflict: 'token' });
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
    await supabase
      .from('device_activity')
      .upsert({ device_id: deviceId, city_id: cityId, last_seen: new Date().toISOString() }, { onConflict: 'device_id' });
  } catch (e) {
    // non-fatal
  }
}

// Monthly active users in a town — drives ad pricing by actual users.
export async function fetchCityUsers(cityId) {
  try {
    const { data, error } = await supabase.rpc('city_active_users', { p_city: cityId });
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

// Reach snapshot for one city: live listing counts, total views per type, the
// most-viewed listings, and how many active ads / featured listings are running.
export async function fetchMetrics(cityId) {
  const [ev, gs, ft, sp] = await Promise.all([
    supabase.from('events').select('id,title,view_count,featured').eq('city_id', cityId).eq('status', 'approved'),
    supabase.from('garage_sales').select('id,title,view_count,featured').eq('city_id', cityId).eq('status', 'approved'),
    supabase.from('food_trucks').select('id,name,view_count,featured').eq('city_id', cityId).eq('status', 'approved'),
    supabase.from('sponsors').select('id,active').eq('city_id', cityId),
  ]);

  const evRows = ev.data || [];
  const gsRows = gs.data || [];
  const ftRows = ft.data || [];
  const spRows = sp.data || [];
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
