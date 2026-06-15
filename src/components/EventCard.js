import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ThemedText from './ThemedText';
import DateChip from './DateChip';
import { colors, spacing, radius, categoryColor } from '../theme/theme';
import { useApp } from '../context/AppContext';
import { relativeDay, timeRange } from '../utils/dates';

function EventCard({ event }) {
  const router = useRouter();
  const { savedIds, toggleSaved, scale } = useApp();
  const saved = savedIds.includes(event.id);
  const accent = categoryColor(event.category);

  return (
    <View style={[styles.card, event.featured && styles.cardFeatured]}>
      <Pressable
        onPress={() => router.push(`/event/${event.id}`)}
        style={({ pressed }) => [styles.tappable, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${event.title}, ${relativeDay(event.start)}, at ${event.venue}`}
      >
        <DateChip date={event.start} accent={accent} scale={scale} />

        <View style={styles.body}>
          <View style={styles.topRow}>
            <View style={[styles.catPill, { backgroundColor: accent + '18' }]}>
              <ThemedText size="tiny" weight="bold" color={accent}>
                {event.category.toUpperCase()}
              </ThemedText>
            </View>
            {event.featured ? (
              <View style={styles.featuredPill}>
                <Ionicons name="star" size={11} color={colors.accent} />
                <ThemedText size="tiny" weight="bold" color={colors.accent}>
                  FEATURED
                </ThemedText>
              </View>
            ) : null}
          </View>

          <ThemedText size="subtitle" weight="bold" numberOfLines={2}>
            {event.title}
          </ThemedText>

          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={15 * scale} color={colors.textMuted} />
            <ThemedText size="small" color={colors.textMuted}>
              {relativeDay(event.start)} · {timeRange(event.start, event.end)}
            </ThemedText>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={15 * scale} color={colors.textMuted} />
            <ThemedText size="small" color={colors.textMuted} numberOfLines={1}>
              {event.venue}
            </ThemedText>
          </View>
        </View>
      </Pressable>

      <Pressable
        onPress={() => toggleSaved(event.id, event)}
        hitSlop={12}
        style={styles.saveBtn}
        accessibilityRole="button"
        accessibilityLabel={saved ? 'Remove from saved' : 'Save event'}
      >
        <Ionicons
          name={saved ? 'heart' : 'heart-outline'}
          size={26 * Math.min(scale, 1.3)}
          color={saved ? colors.danger : colors.textMuted}
        />
      </Pressable>
    </View>
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
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardFeatured: {
    borderColor: colors.accent,
    backgroundColor: colors.accentLight + '66',
  },
  tappable: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
    borderRadius: radius.md,
    alignItems: 'flex-start',
  },
  pressed: { opacity: 0.6 },
  body: { flex: 1, gap: 4 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  catPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  featuredPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accentLight,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  saveBtn: {
    alignSelf: 'flex-start',
    padding: 4,
  },
});

// Memoized: cards only re-render when their event prop changes, so typing in
// search (which rebuilds the list) doesn't re-render every visible card.
export default React.memo(EventCard);
