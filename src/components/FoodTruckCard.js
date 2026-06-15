import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ThemedText from './ThemedText';
import DateChip from './DateChip';
import { colors, spacing, radius } from '../theme/theme';
import { useApp } from '../context/AppContext';
import { CUISINE_EMOJI } from '../data/foodTrucks';
import { relativeDay, daysFromNow } from '../utils/dates';

function whenBadge(truck) {
  const d = daysFromNow(truck.date);
  if (d === 0) return { label: 'TODAY', color: colors.success };
  if (d === 1) return { label: 'TOMORROW', color: colors.foodTruck };
  return null;
}

export default function FoodTruckCard({ truck }) {
  const router = useRouter();
  const { scale } = useApp();
  const accent = colors.foodTruck;
  const badge = whenBadge(truck);

  return (
    <Pressable
      onPress={() => router.push(`/food-truck/${truck.id}`)}
      style={({ pressed }) => [styles.card, truck.featured && styles.cardFeatured, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${truck.name}, ${relativeDay(truck.date)}, at ${truck.locationName}`}
    >
      <DateChip date={truck.date} accent={accent} scale={scale} />

      <View style={styles.body}>
        <View style={styles.topRow}>
          <View style={[styles.pill, { backgroundColor: accent + '18' }]}>
            <ThemedText size="tiny" weight="bold" color={accent}>
              {CUISINE_EMOJI[truck.cuisine] ? `${CUISINE_EMOJI[truck.cuisine]} ` : ''}{truck.cuisine.toUpperCase()}
            </ThemedText>
          </View>
          {truck.featured ? (
            <View style={styles.featuredPill}>
              <Ionicons name="star" size={11} color={colors.accent} />
              <ThemedText size="tiny" weight="bold" color={colors.accent}>FEATURED</ThemedText>
            </View>
          ) : null}
          {badge ? (
            <View style={[styles.whenPill, { backgroundColor: badge.color + '1F' }]}>
              <ThemedText size="tiny" weight="bold" color={badge.color}>{badge.label}</ThemedText>
            </View>
          ) : null}
        </View>

        <ThemedText size="subtitle" weight="bold" numberOfLines={2}>
          {truck.name}
        </ThemedText>

        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={15 * scale} color={colors.textMuted} />
          <ThemedText size="small" color={colors.textMuted}>
            {relativeDay(truck.date)} · {truck.startTime}–{truck.endTime}
          </ThemedText>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={15 * scale} color={colors.textMuted} />
          <ThemedText size="small" color={colors.textMuted} numberOfLines={1}>
            {truck.locationName}
          </ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'flex-start',
    shadowColor: colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardFeatured: { borderColor: colors.accent, backgroundColor: colors.accentLight + '66' },
  pressed: { opacity: 0.6 },
  body: { flex: 1, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pill: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 2 },
  whenPill: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  featuredPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accentLight,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
