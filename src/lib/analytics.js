import { isSupabaseEnabled, supabase } from './supabase';

// Fire-and-forget product analytics. Inserts a single anonymous interaction
// row into app_events. NEVER throws and NEVER blocks the UI — analytics must
// not be able to break the app. No-op when there's no backend configured.
export function trackEvent({ event, props = {}, deviceId = null, cityId = null }) {
  if (!isSupabaseEnabled || !event) return;
  try {
    const q = supabase.from('app_events').insert({ device_id: deviceId, event, city_id: cityId, props });
    if (q && typeof q.then === 'function') q.then(() => {}, () => {});
  } catch {
    // swallow — analytics is best-effort only
  }
}
