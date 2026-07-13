import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ThemedText from './ThemedText';
import FadeInImage from './FadeInImage';
import DateChip from './DateChip';
import Pill from './Pill';
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

function FoodTruckCard({ truck }) {
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
          <Pill
            label={`${CUISINE_EMOJI[truck.cuisine] ? `${CUISINE_EMOJI[truck.cuisine]} ` : ''}${(truck.cuisine || 'Food').toUpperCase()}`}
            color={accent}
            bg={accent + '18'}
          />
          {truck.featured ? (
            <Pill label="FEATURED" color={colors.accent} bg={colors.accentLight} icon="star" />
          ) : null}
          {badge ? <Pill label={badge.label} color={badge.color} bg={badge.color + '1F'} /> : null}
        </View>

        <ThemedText size="subtitle" weight="bold" numberOfLines={2}>
          {truck.name}
        </ThemedText>

        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={15 * scale} color={colors.textMuted} />
          <ThemedText size="small" color={colors.textMuted}>
            {relativeDay(truck.date)} · {truck.startTime} to {truck.endTime}
          </ThemedText>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={15 * scale} color={colors.textMuted} />
          <ThemedText size="small" color={colors.textMuted} numberOfLines={1}>
            {truck.locationName}
          </ThemedText>
        </View>
        <View style={styles.metaRow}>
          <Ionicons
            name={truck.source === 'calendar' ? 'calendar' : 'person-circle'}
            size={15 * scale}
            color={colors.foodTruck}
          />
          <ThemedText size="tiny" color={colors.foodTruck} weight="bold">
            {truck.source === 'calendar' ? "From the truck's schedule" : 'Posted by a neighbor'}
          </ThemedText>
        </View>
      </View>
      {truck.imageUrl ? (
        <FadeInImage source={{ uri: truck.imageUrl }} style={styles.thumb} resizeMode="cover" />
      ) : null}
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
  body: { flex: 1, gap: spacing.xs },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  thumb: { width: 68, height: 68, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignSelf: 'center' },
});

export default React.memo(FoodTruckCard);
