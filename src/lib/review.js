import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Rating prompt policy:
//   - First ask only after the user has opened the app a few times (they've
//     formed an opinion).
//   - "Rate" -> open the store's review page AND stop asking forever (we treat a
//     tap as "they rated"; the OS never tells us the real outcome).
//   - "Maybe later" (skip) -> ask again in 2 weeks, up to a few times total, then
//     stop for good so we never nag.
const APPLE_URL = 'https://apps.apple.com/app/id6780306721?action=write-review';
const PLAY_MARKET_URL = 'market://details?id=com.michaelwilliams.localloop';
const PLAY_WEB_URL = 'https://play.google.com/store/apps/details?id=com.michaelwilliams.localloop';

const KEY_OPENS = '@fe/reviewOpens';
const KEY_DONE = '@fe/reviewDone';      // they tapped Rate — never ask again
const KEY_NEXT = '@fe/reviewNextAt';    // epoch ms: earliest time to ask again after a skip
const KEY_ASKS = '@fe/reviewAskCount';  // how many times we've shown the prompt
const KEY_FIRST = '@fe/reviewFirstAt';  // epoch ms of the first open (a "used it a while" gate)

// Deliberately gentle so the prompt never feels naggy — a rating is a bonus, not
// something to badger people for.
const MIN_OPENS = 8;                            // opens before the FIRST ask (was 4)
const MIN_DAYS_INSTALLED = 4;                   // AND they've had the app at least this many days
const REPROMPT_MS = 45 * 24 * 60 * 60 * 1000;   // ~6 weeks between asks (was 2 weeks)
const MAX_ASKS = 2;                             // at most 2 asks ever, then stop for good (was 3)

export function openReview() {
  if (Platform.OS === 'android') {
    // market:// opens the Play Store app directly; fall back to the web listing.
    Linking.openURL(PLAY_MARKET_URL).catch(() => Linking.openURL(PLAY_WEB_URL).catch(() => {}));
  } else {
    Linking.openURL(APPLE_URL).catch(() => {});
  }
}

const num = async (k) => parseInt((await AsyncStorage.getItem(k)) || '0', 10) || 0;

export async function maybePromptReview() {
  try {
    if ((await AsyncStorage.getItem(KEY_DONE)) === 'true') return; // already rated

    // Stamp the first-open time once, so we can require they've had the app a few
    // days — not just launched it 8 times in one sitting.
    let firstAt = await num(KEY_FIRST);
    if (!firstAt) { firstAt = Date.now(); await AsyncStorage.setItem(KEY_FIRST, String(firstAt)); }

    const opens = (await num(KEY_OPENS)) + 1;
    await AsyncStorage.setItem(KEY_OPENS, String(opens));
    if (opens < MIN_OPENS) return; // not engaged enough yet
    if (Date.now() - firstAt < MIN_DAYS_INSTALLED * 24 * 60 * 60 * 1000) return; // give it a few days first

    const asks = await num(KEY_ASKS);
    if (asks >= MAX_ASKS) return; // asked enough times, stop nagging

    const nextAt = await num(KEY_NEXT);
    if (nextAt && Date.now() < nextAt) return; // still inside the ~6-week cooldown

    // Record that we're asking now, and pre-set the next window in case they skip.
    await AsyncStorage.setItem(KEY_ASKS, String(asks + 1));
    await AsyncStorage.setItem(KEY_NEXT, String(Date.now() + REPROMPT_MS));

    Alert.alert(
      'Enjoying Local Loop?',
      'A quick rating helps other locals find it. It only takes a few seconds.',
      [
        // Skip: cooldown + ask-count were already set above, so it re-asks in 2 weeks.
        { text: 'Maybe later', style: 'cancel' },
        {
          text: 'Rate Local Loop',
          onPress: async () => {
            await AsyncStorage.setItem(KEY_DONE, 'true'); // don't ask again
            openReview();
          },
        },
      ]
    );
  } catch {
    // non-fatal
  }
}
