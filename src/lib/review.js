import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Rating prompt policy — GOLD STANDARD: use the OS-native in-app review card
// (expo-store-review, SDK 54) when the running build has the native module. It
// shows an inline rating sheet WITHOUT leaving the app and is throttled by
// Apple/Google automatically (iOS ~3x/year, and it's a silent no-op if the user
// already rated). On builds that don't have the native module yet (older binaries
// this JS is OTA'd to), on TestFlight, or on web, we fall back to a gentle custom
// prompt that links out to the store.
//
// Gating (applies to BOTH paths) is deliberately light so it never nags:
//   - first ask only after MIN_OPENS opens AND MIN_DAYS_INSTALLED days installed
//   - fallback "Rate" -> open the store review page and stop asking forever
//   - the native path relies on the OS throttle plus a self-imposed cooldown
const APPLE_URL = 'https://apps.apple.com/app/id6780306721?action=write-review';
const PLAY_MARKET_URL = 'market://details?id=com.michaelwilliams.localloop';
const PLAY_WEB_URL = 'https://play.google.com/store/apps/details?id=com.michaelwilliams.localloop';

const KEY_OPENS = '@fe/reviewOpens';
const KEY_DONE = '@fe/reviewDone';      // fallback path: they tapped Rate — never ask again
const KEY_NEXT = '@fe/reviewNextAt';    // epoch ms: earliest time to prompt again
const KEY_ASKS = '@fe/reviewAskCount';  // fallback path: how many times we've shown the custom prompt
const KEY_FIRST = '@fe/reviewFirstAt';  // epoch ms of the first open (a "used it a while" gate)

const MIN_OPENS = 8;                                  // opens before the FIRST ask
const MIN_DAYS_INSTALLED = 4;                         // AND they've had the app at least this many days
const REPROMPT_MS = 45 * 24 * 60 * 60 * 1000;         // fallback: ~6 weeks between custom asks
const MAX_ASKS = 2;                                   // fallback: at most 2 custom asks ever, then stop
const NATIVE_COOLDOWN_MS = 120 * 24 * 60 * 60 * 1000; // native: request at most ~once/4mo (OS ignores extras anyway)

// Load expo-store-review DEFENSIVELY. On a binary built without the native module
// (e.g. an older build this JS gets OTA'd to), requiring it can throw — swallow
// that and fall back. This require lives inside a function (never at module top
// level) so importing review.js can never crash app startup.
function nativeReview() {
  try { return require('expo-store-review'); } catch { return null; }
}

export function openReview() {
  if (Platform.OS === 'android') {
    // market:// opens the Play Store app directly; fall back to the web listing.
    Linking.openURL(PLAY_MARKET_URL).catch(() => Linking.openURL(PLAY_WEB_URL).catch(() => {}));
  } else {
    Linking.openURL(APPLE_URL).catch(() => {});
  }
}

const num = async (k) => parseInt((await AsyncStorage.getItem(k)) || '0', 10) || 0;

// Gentle custom fallback (older binaries without the native module / TestFlight / web).
async function fallbackPrompt() {
  const asks = await num(KEY_ASKS);
  if (asks >= MAX_ASKS) return; // asked enough times, stop nagging
  const nextAt = await num(KEY_NEXT);
  if (nextAt && Date.now() < nextAt) return; // still inside the ~6-week cooldown
  await AsyncStorage.setItem(KEY_ASKS, String(asks + 1));
  await AsyncStorage.setItem(KEY_NEXT, String(Date.now() + REPROMPT_MS));
  Alert.alert(
    'Enjoying Local Loop?',
    'A quick rating helps other locals find it. It only takes a few seconds.',
    [
      { text: 'Maybe later', style: 'cancel' },
      {
        text: 'Rate Local Loop',
        onPress: async () => { await AsyncStorage.setItem(KEY_DONE, 'true'); openReview(); },
      },
    ]
  );
}

export async function maybePromptReview() {
  try {
    if ((await AsyncStorage.getItem(KEY_DONE)) === 'true') return; // already rated (fallback path)

    // "Used it a while" gate — stamp the first open once, then require both a few
    // opens AND a few days, so a heavy first-day user is never prompted.
    let firstAt = await num(KEY_FIRST);
    if (!firstAt) { firstAt = Date.now(); await AsyncStorage.setItem(KEY_FIRST, String(firstAt)); }
    const opens = (await num(KEY_OPENS)) + 1;
    await AsyncStorage.setItem(KEY_OPENS, String(opens));
    if (opens < MIN_OPENS) return;
    if (Date.now() - firstAt < MIN_DAYS_INSTALLED * 24 * 60 * 60 * 1000) return;

    // GOLD STANDARD: native in-app review when this build supports it.
    const SR = nativeReview();
    if (SR) {
      let available = false;
      try { available = await SR.isAvailableAsync(); } catch { available = false; } // false on TestFlight / web / old Android
      if (available) {
        // Self-throttle on top of the OS throttle so we never request every launch.
        const nextAt = await num(KEY_NEXT);
        if (nextAt && Date.now() < nextAt) return;
        await AsyncStorage.setItem(KEY_NEXT, String(Date.now() + NATIVE_COOLDOWN_MS));
        try { await SR.requestReview(); } catch { /* ERR_STORE_REVIEW_FAILED — silent, OS-governed */ }
        return;
      }
    }

    // Fallback: gentle custom prompt that links out to the store.
    await fallbackPrompt();
  } catch {
    // non-fatal — a rating prompt must never break the app
  }
}
