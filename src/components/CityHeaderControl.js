import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ThemedText from './ThemedText';
import { useApp } from '../context/AppContext';
import { colors, spacing, radius } from '../theme/theme';

// Shared colored header used by the Events, Garage Sales, and Food Trucks tabs
// so all three carry the same "which city am I in / change it" control. Events
// also gets the Calendar + Map shortcuts. Pass a `trailing` node (e.g. a Post
// button) to sit before the Change pill.
export default function CityHeaderControl({
  bg = colors.primary,
  label,
  showTagline = false,
  showViews = false,
  trailing = null,
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { city, scale, logEvent } = useApp();
  const iconSize = 20 * Math.min(scale, 1.2);

  return (
    <View style={[styles.header, { backgroundColor: bg, paddingTop: insets.top + spacing.sm }]}>
      <View style={{ flex: 1 }}>
        <ThemedText size="tiny" color={colors.textInverse} style={{ opacity: 0.85 }}>
          {label}
        </ThemedText>
        <ThemedText size="large" weight="bold" color={colors.textInverse}>
          {city.name}, {city.state}
        </ThemedText>
        {showTagline ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 1 }}>
            <Ionicons name="location" size={13} color={colors.textInverse} style={{ opacity: 0.9 }} />
            <ThemedText size="small" color={colors.textInverse} style={{ opacity: 0.9 }}>
              {city.tagline}
            </ThemedText>
          </View>
        ) : null}
      </View>

      {showViews ? (
        <>
          <Pressable
            onPress={() => { logEvent('open_calendar'); router.push('/calendar'); }}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Calendar view"
          >
            <Ionicons name="calendar" size={iconSize} color={colors.primary} />
          </Pressable>
          <Pressable
            onPress={() => { logEvent('open_map'); router.push('/map'); }}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Map view"
          >
            <Ionicons name="map" size={iconSize} color={colors.primary} />
          </Pressable>
        </>
      ) : null}

      {trailing}

      <Pressable
        onPress={() => router.push('/city')}
        style={styles.changeCity}
        accessibilityRole="button"
        accessibilityLabel="Change city"
      >
        <Ionicons name="swap-horizontal" size={iconSize} color={colors.primary} />
        <ThemedText size="small" weight="semibold" color={colors.primary}>
          Change
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  changeCity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    minHeight: 44,
  },
  iconBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    width: 44,
    height: 44,
    borderRadius: radius.pill,
  },
});
