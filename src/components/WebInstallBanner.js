import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Pressable, Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import { APP_STORE_URL, PLAY_STORE_URL, ANDROID_LIVE } from '../lib/links';
import { colors, spacing, radius } from '../theme/theme';

// Web-only "get the native app" nudge for localloop.io visitors. The browser app
// works, but the native app adds push notifications for events near them. Renders
// ONLY on web (never on the native apps), and stays dismissed once closed.
const KEY = '@fe/webInstallDismissed';

export default function WebInstallBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    AsyncStorage.getItem(KEY).then((v) => { if (!v) setShow(true); }).catch(() => {});
  }, []);

  // An Android visitor has nothing to install until the Play listing is live,
  // and the button pointed them at the APPLE App Store — a dead end for exactly
  // the audience the web app exists to serve. Show nothing rather than sell an
  // app they cannot get.
  const isAndroidUA = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent || '');
  if (Platform.OS !== 'web' || !show || (isAndroidUA && !ANDROID_LIVE)) return null;

  const dismiss = () => { setShow(false); AsyncStorage.setItem(KEY, '1').catch(() => {}); };

  // Lead with the store that matches the visitor's device. Android only when its
  // public listing is live (ANDROID_LIVE) — otherwise fall back to the App Store.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const onAndroid = /android/i.test(ua) && ANDROID_LIVE;
  const target = onAndroid
    ? { url: PLAY_STORE_URL, label: 'Get it on Google Play' }
    : { url: APP_STORE_URL, label: 'Download on the App Store' };

  return (
    <View style={styles.bar}>
      <Ionicons name="phone-portrait-outline" size={24} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <ThemedText size="small" weight="bold">Get the free Local Loop app</ThemedText>
        <ThemedText size="tiny" color={colors.textMuted}>
          Notifications for events near you{ANDROID_LIVE ? '' : ' — iPhone now, Android soon'}.
        </ThemedText>
      </View>
      <Pressable
        style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
        onPress={() => Linking.openURL(target.url).catch(() => {})}
        accessibilityRole="link"
        accessibilityLabel={target.label}
      >
        <ThemedText size="small" weight="bold" color={colors.textInverse}>Get app</ThemedText>
      </Pressable>
      <Pressable onPress={dismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Ionicons name="close" size={20} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 40,
    justifyContent: 'center',
  },
});
