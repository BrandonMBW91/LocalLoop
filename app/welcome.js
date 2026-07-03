import React from 'react';
import { View, Image, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { colors, spacing, radius } from '../src/theme/theme';

// One-time first-launch welcome. Explains what the app is in a single sentence
// and sends the user straight to picking their town — so nobody lands on the
// wrong city wondering why "their" events look unfamiliar.
export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { city, completeOnboarding } = useApp();

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
          Events, garage sales, and food trucks near you in NW and Central Ohio, all in one place.
        </ThemedText>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={chooseTown}
          style={styles.primaryBtn}
          accessibilityRole="button"
          accessibilityLabel="Choose your town"
        >
          <ThemedText size="subtitle" weight="bold" color={colors.primary}>
            Choose your town
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={useDefault}
          style={styles.secondaryBtn}
          accessibilityRole="button"
          accessibilityLabel={`Continue with ${city.name}`}
        >
          <ThemedText size="body" weight="semibold" color={colors.textInverse} style={{ opacity: 0.95 }}>
            Continue with {city.name}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.primary,
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
  actions: { gap: spacing.md },
  primaryBtn: {
    backgroundColor: colors.surface,
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
