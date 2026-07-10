import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

// OTA updates without waiting for an app death. Both iOS and Android keep the
// app alive in memory for days, and expo-updates' built-in ON_LOAD check only
// runs on a cold start — so a published update could take days to reach open
// apps. This hook makes FOREGROUNDING the trigger instead:
//   foreground -> check + download (throttled)
//   background -> apply the downloaded update (invisible reload while the user
//                 isn't looking; next foreground runs the new code)
// If the OS kills the app before the next background, the downloaded update
// applies on cold start anyway — this only ever shortens the wait.
const CHECK_EVERY_MS = 15 * 60 * 1000; // foreground churn is frequent; be polite
const EARLY_APPLY_WINDOW_MS = 15 * 1000; // reload-in-place is fine this early
const LAUNCHED_AT = Date.now();

export function useOtaUpdates() {
  // isUpdatePending covers BOTH our foreground fetches and the launch-time
  // ON_LOAD download, so updates from either path apply on the next background.
  const { isUpdatePending } = Updates.useUpdates();
  const pendingRef = useRef(false);
  pendingRef.current = isUpdatePending;
  const lastCheckRef = useRef(0);

  // Fresh-launch fast path: when the launch-time ON_LOAD download finishes
  // within the first seconds of a cold start, apply it immediately instead of
  // waiting for a background. A reload flash that early is fine — the user has
  // barely started — and it means a NEW install's first session runs the
  // newest bundle instead of the embedded store one.
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    if (isUpdatePending && Date.now() - LAUNCHED_AT < EARLY_APPLY_WINDOW_MS) {
      Updates.reloadAsync().catch(() => {});
    }
  }, [isUpdatePending]);

  useEffect(() => {
    // No-op in dev / Expo Go, where the Updates API rejects.
    if (__DEV__ || !Updates.isEnabled) return undefined;

    const check = async () => {
      if (Date.now() - lastCheckRef.current < CHECK_EVERY_MS) return;
      lastCheckRef.current = Date.now();
      try {
        const { isAvailable } = await Updates.checkForUpdateAsync();
        if (isAvailable) await Updates.fetchUpdateAsync();
      } catch {
        // Network flake or store misconfig — never surface; next foreground retries.
      }
    };

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        check();
      } else if (state === 'background' && pendingRef.current) {
        // 'background' only — iOS fires transient 'inactive' for the app
        // switcher / control center, and reloading there would be visible.
        Updates.reloadAsync().catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);
}
