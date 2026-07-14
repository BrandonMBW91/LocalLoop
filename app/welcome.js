import React, { useState, useEffect } from 'react';
import { View, Image, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { CITIES } from '../src/data/cities';
import { fetchUpcomingEventCount } from '../src/lib/db';
import { colors, spacing, radius } from '../src/theme/theme';

// One-time first-launch welcome. Explains what the app is in a single sentence
// and sends the user straight to picking their town — so nobody lands on the
// wrong city wondering why "their" events look unfamiliar.
export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { completeOnboarding, backendEnabled, activeCityIds } = useApp();

  // Live social proof: how much is already in the app across Ohio.
  const [eventCount, setEventCount] = useState(null);
  useEffect(() => {
    if (!backendEnabled) return;
    let ok = true;
    fetchUpcomingEventCount().then((n) => { if (ok) setEventCount(n); }).catch(() => {});
    return () => { ok = false; };
  }, [backendEnabled]);
  // Match the picker: count towns that actually have events right now (the
  // static catalog says 133, but the picker one tap later lists the live set).
  const townCount = activeCityIds && activeCityIds.size ? activeCityIds.size : CITIES.length;
  const stat = eventCount
    ? `${(Math.floor(eventCount / 100) * 100).toLocaleString()}+ events across ${townCount} Ohio towns`
    : `${townCount} Ohio towns and growing`;

  const chooseTown = () => router.push({ pathname: '/city', params: { onboarding: '1' } });
  const useDefault = () => {
    completeOnboarding();
    router.replace('/');
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.hero}>
        <Image source={require('../assets/icon.png')} style={styles.logo} resizeMode="contain" />
        <ThemedText size="huge" weight="bold" color={colors.textInverse} style={styles.brand}>
          Local Loop
        </ThemedText>
        <ThemedText size="subtitle" color={colors.textInverse} style={styles.tagline}>
          Events, garage sales, and food trucks near you, all across Ohio.
        </ThemedText>
        <View style={styles.statPill}>
          <ThemedText size="small" weight="bold" color={colors.textInverse}>
            {stat}
          </ThemedText>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={chooseTown}
          style={styles.primaryBtn}
          accessibilityRole="button"
          accessibilityLabel="Choose your town"
        >
          <ThemedText size="subtitle" weight="bold" color="#15315B">
            Choose your town
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={useDefault}
          style={styles.secondaryBtn}
          accessibilityRole="button"
          accessibilityLabel="Skip for now"
        >
          <ThemedText size="body" weight="semibold" color={colors.textInverse} style={{ opacity: 0.95 }}>
            Skip for now
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    // Fixed brand navy in BOTH schemes — this is the first branded moment, so it
    // must not invert to the theme's bright dark-mode blue (colors.primary).
    backgroundColor: '#15315B',
    paddingHorizontal: spacing.xl,
    justifyContent: 'space-between',
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  logo: {
    width: 128,
    height: 128,
    borderRadius: 28,
    marginBottom: spacing.sm,
  },
  brand: { textAlign: 'center' },
  tagline: { textAlign: 'center', opacity: 0.95, lineHeight: 28 },
  statPill: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  actions: { gap: spacing.md },
  primaryBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
    minHeight: 56,
    justifyContent: 'center',
  },
  secondaryBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
});
