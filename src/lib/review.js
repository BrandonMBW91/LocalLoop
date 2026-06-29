import { Alert, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Deep link straight to the App Store review composer for Local Loop.
const REVIEW_URL = 'https://apps.apple.com/app/id6780306721?action=write-review';
const KEY_OPENS = '@fe/reviewOpens';
const KEY_DONE = '@fe/reviewPrompted';

export function openReview() {
  Linking.openURL(REVIEW_URL).catch(() => {});
}

// Count app opens and, once the user has opened the app a few times (enough to
// have formed an opinion), ask one time for a rating. Linking-based so it ships
// over-the-air with no native module. Fires at most once, ever.
export async function maybePromptReview() {
  try {
    if ((await AsyncStorage.getItem(KEY_DONE)) === 'true') return;
    const n = (parseInt(await AsyncStorage.getItem(KEY_OPENS), 10) || 0) + 1;
    await AsyncStorage.setItem(KEY_OPENS, String(n));
    if (n < 3) return; // give them a couple of sessions first
    await AsyncStorage.setItem(KEY_DONE, 'true');
    Alert.alert(
      'Enjoying Local Loop?',
      'A quick rating helps other locals find it. It only takes a few seconds.',
      [
        { text: 'Maybe later', style: 'cancel' },
        { text: 'Rate Local Loop', onPress: openReview },
      ]
    );
  } catch {
    // non-fatal
  }
}
