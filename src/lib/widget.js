// #8 Widget data bridge — writes "this weekend" events into the shared App Group
// container the iOS widget reads. STAGED: no-ops until the native widget target +
// App Group ship (targets/widget/README.md). Guarded require so OTA on a binary
// without the native module is a silent no-op, never a crash.
import { Platform } from 'react-native';
import { formatShortDate, formatTime } from '../utils/dates';

let SharedGroupPreferences = null;
try { SharedGroupPreferences = require('react-native-shared-group-preferences').default; } catch { SharedGroupPreferences = null; }

const APP_GROUP = 'group.com.michaelwilliams.localloop';

export const widgetAvailable = () => Platform.OS === 'ios' && Boolean(SharedGroupPreferences);

// Called on app open / data refresh with the current town + its upcoming events.
export async function updateWidget(townName, events = []) {
  try {
    if (!widgetAvailable()) return;
    // The soonest 3 upcoming events, shaped for the Swift decoder.
    const rows = (events || []).slice(0, 3).map((e) => ({
      title: (e.title || '').slice(0, 60),
      day: shortWhen(e.start),
      venue: (e.venue || e.address || '').slice(0, 40),
    }));
    const payload = { town: townName || 'your town', events: rows, updated: new Date().toISOString() };
    await SharedGroupPreferences.setItem('widgetData', JSON.stringify(payload), APP_GROUP);
  } catch {
    // Best-effort; the widget just shows its last-known / empty state.
  }
}

// Hermes-safe: the app runs on Hermes (no Intl/ICU), so build the label from the
// shared date helpers rather than toLocale* (which ignore locale/options on device).
function shortWhen(iso) {
  try {
    return `${formatShortDate(iso)} ${formatTime(iso)}`; // e.g. "Sat, Jun 20 5 PM"
  } catch { return ''; }
}
