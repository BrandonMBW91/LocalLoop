import { useEffect, useRef } from 'react';
import { AppState, Alert, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Nudge users to the App Store when a NEWER NATIVE build is published. OTA (JS)
// updates already apply automatically (see useOtaUpdates) — but a new store binary
// (native changes / a new runtime) can't ship over OTA, so users on the old version
// would otherwise never know. iOS only: the iTunes lookup returns the live App Store
// version reliably; Android has no equivalent public API (and is in closed testing).
// Soft + dismissible, and at most once per day for a given version so it never nags.
const APP_STORE_ID = '6780306721';
const APP_STORE_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`;
const LOOKUP_URL = `https://itunes.apple.com/lookup?id=${APP_STORE_ID}&country=us`;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;   // don't hit iTunes on every foreground
const NAG_COOLDOWN_MS = 24 * 60 * 60 * 1000; // re-prompt for the same version at most daily
const STORAGE_KEY = '@fe/storeUpdateAsked';

// true if dotted version `store` is newer than `installed`, compared segment by segment.
function isNewer(store, installed) {
  const a = String(store).split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(installed).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function useStoreUpdatePrompt() {
  const lastCheckRef = useRef(0);

  useEffect(() => {
    // iOS store only; skip dev / Expo Go where a store version is meaningless.
    if (Platform.OS !== 'ios' || __DEV__) return undefined;
    const installed = Constants.expoConfig?.version;
    if (!installed) return undefined;

    const check = async () => {
      if (Date.now() - lastCheckRef.current < CHECK_EVERY_MS) return;
      lastCheckRef.current = Date.now();

      let storeVersion;
      try {
        const res = await fetch(LOOKUP_URL);
        storeVersion = (await res.json())?.results?.[0]?.version;
      } catch {
        return; // network flake — never surface; next foreground retries
      }
      if (!storeVersion || !isNewer(storeVersion, installed)) return;

      // Don't re-nag: at most once per day for a given store version.
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const { version, at } = JSON.parse(raw);
          if (version === storeVersion && Date.now() - at < NAG_COOLDOWN_MS) return;
        }
      } catch { /* ignore and prompt anyway */ }
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ version: storeVersion, at: Date.now() })).catch(() => {});

      Alert.alert(
        'Update available',
        'A new version of Local Loop is ready on the App Store, with the latest features and fixes.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Update', onPress: () => Linking.openURL(APP_STORE_URL).catch(() => {}) },
        ],
      );
    };

    check(); // on mount
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, []);
}
