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

const MIN_OPENS = 4;                            // opens before the first ask
const REPROMPT_MS = 14 * 24 * 60 * 60 * 1000;   // 2 weeks between asks
const MAX_ASKS = 3;                             // stop asking after this many skips

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

    const opens = (await num(KEY_OPENS)) + 1;
    await AsyncStorage.setItem(KEY_OPENS, String(opens));
    if (opens < MIN_OPENS) return; // not engaged enough yet

    const asks = await num(KEY_ASKS);
    if (asks >= MAX_ASKS) return; // asked enough times, stop nagging

    const nextAt = await num(KEY_NEXT);
    if (nextAt && Date.now() < nextAt) return; // still inside the 2-week cooldown

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
