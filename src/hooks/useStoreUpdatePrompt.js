import { useEffect, useRef } from 'react';
import { AppState, Alert, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchVersionGate } from '../lib/db';

// Cross-platform "update available" prompt driven by a server-side version gate
// (app_config row: { ios:{latest,min,url}, android:{latest,min,url} }). OTA (JS)
// updates already apply automatically (see useOtaUpdates) — this only fires for a NEW
// NATIVE STORE build, which OTA can't deliver. Because the target version lives on the
// server, announcing a new iOS or Android build is one row edit, no code change / OTA.
//   running < min    -> forced prompt (single button, re-prompts every foreground)
//   running < latest -> soft prompt (dismissible, at most once/day per version)
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;   // don't hit the config on every foreground
const NAG_COOLDOWN_MS = 24 * 60 * 60 * 1000; // re-prompt the soft case at most daily
const STORAGE_KEY = '@fe/storeUpdateAsked';

// true if dotted version `a` is newer than `b`, compared segment by segment (numeric).
function isNewer(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function useStoreUpdatePrompt() {
  const lastCheckRef = useRef(0);

  useEffect(() => {
    // Native stores only; skip web + dev / Expo Go where a store version is meaningless.
    if (__DEV__ || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return undefined;
    const installed = Constants.expoConfig?.version;
    if (!installed) return undefined;

    const check = async () => {
      if (Date.now() - lastCheckRef.current < CHECK_EVERY_MS) return;
      lastCheckRef.current = Date.now();

      const gate = await fetchVersionGate();
      const cfg = gate && gate[Platform.OS];
      if (!cfg || !cfg.url) return;

      const belowMin = cfg.min && isNewer(cfg.min, installed);
      const belowLatest = cfg.latest && isNewer(cfg.latest, installed);
      if (!belowMin && !belowLatest) return; // up to date

      const open = () => Linking.openURL(cfg.url).catch(() => {});

      if (belowMin) {
        // Forced: single action, not cancelable, and re-prompts every foreground until
        // they update (no cooldown). Use only for a genuinely required version.
        Alert.alert(
          'Update required',
          'Please update Local Loop to the latest version to keep using it.',
          [{ text: 'Update', onPress: open }],
          { cancelable: false },
        );
        return;
      }

      // Soft: at most once per day for a given target version, dismissible.
      const target = cfg.latest;
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const { version, at } = JSON.parse(raw);
          if (version === target && Date.now() - at < NAG_COOLDOWN_MS) return;
        }
      } catch { /* ignore and prompt anyway */ }
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ version: target, at: Date.now() })).catch(() => {});

      Alert.alert(
        'Update available',
        'A new version of Local Loop is ready, with the latest features and fixes.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Update', onPress: open },
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
