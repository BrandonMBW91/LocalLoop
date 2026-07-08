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
      {/* Actions live on their own top row so they never squeeze the city title.
          Previously they shared the title's row and, on the Sales/Food tabs (wide
          Post pill + Change pill), left the title column so narrow that Android
          character-broke long names ("Tole / do,"). */}
      <View style={styles.actionsRow}>
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

      {/* Title block gets the full width. numberOfLines={1} + adjustsFontSizeToFit
          keeps even the longest names ("Bellefontaine, OH") on one clean line at
          any text-size setting instead of ever wrapping mid-word. */}
      <ThemedText size="tiny" color={colors.textInverse} numberOfLines={1} style={{ opacity: 0.85 }}>
        {label}
      </ThemedText>
      <ThemedText
        size="large"
        weight="bold"
        color={colors.textInverse}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={{ marginTop: 2 }}
      >
        {city.name}, {city.state}
      </ThemedText>
      {showTagline ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 }}>
          <Ionicons name="location" size={13} color={colors.textInverse} style={{ opacity: 0.9 }} />
          <ThemedText size="small" color={colors.textInverse} style={{ opacity: 0.9 }} numberOfLines={1}>
            {city.tagline}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginBottom: spacing.sm,
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
