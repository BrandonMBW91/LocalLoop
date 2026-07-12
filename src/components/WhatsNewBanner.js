import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ThemedText from './ThemedText';
import { BUILD, WHATS_NEW } from '../version';
import { colors } from '../theme/theme';

// A gentle, dismissible "what's new" banner shown ONCE after the app updates (a fresh
// OTA or a new binary). It reads the app's revision (BUILD) and shows the current
// WHATS_NEW line when the rev has advanced since the user last saw it — never on a
// fresh install. Fails silent on any storage error.
const SEEN_KEY = '@fe/lastSeenBuild';
const ONBOARDED_KEY = '@fe/onboarded';

export default function WhatsNewBanner() {
  const insets = useSafeAreaInsets();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [seenRaw, onboarded] = await Promise.all([
          AsyncStorage.getItem(SEEN_KEY),
          AsyncStorage.getItem(ONBOARDED_KEY),
        ]);
        const seen = seenRaw != null ? parseInt(seenRaw, 10) : null;
        // Show after an UPDATE only: the rev advanced, or an existing (onboarded) user
        // is seeing the banner for the first time. Never for a brand-new install.
        const isUpdate = seen != null ? seen < BUILD : onboarded === 'true';
        if (isUpdate && WHATS_NEW && alive) setShow(true);
        // Mark this rev seen NOW, whether or not we showed the banner. Writing it only
        // on dismiss meant a user who saw the banner but swiped the app away without
        // tapping the X got it again on every cold launch — this keeps it a one-time
        // "what's new" moment, as intended.
        AsyncStorage.setItem(SEEN_KEY, String(BUILD)).catch(() => {});
      } catch { /* fail silent */ }
    })();
    return () => { alive = false; };
  }, []);

  const dismiss = () => {
    setShow(false);
    AsyncStorage.setItem(SEEN_KEY, String(BUILD)).catch(() => {});
  };

  if (!show) return null;
  return (
    <View style={[styles.wrap, { bottom: insets.bottom + 14 }]} pointerEvents="box-none">
      <View style={styles.card}>
        <Ionicons name="sparkles" size={18} color={colors.accent} style={{ marginRight: 10 }} />
        <View style={{ flex: 1 }}>
          <ThemedText size="small" weight="bold">What's new</ThemedText>
          <ThemedText size="small" color={colors.textMuted}>{WHATS_NEW}</ThemedText>
        </View>
        <Pressable onPress={dismiss} hitSlop={12} accessibilityRole="button" accessibilityLabel="Dismiss what's new">
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
