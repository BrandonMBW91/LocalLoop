import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Pressable, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ThemedText from './ThemedText';
import FadeInImage from './FadeInImage';
import DateChip from './DateChip';
import Pill from './Pill';
import { colors, spacing, radius, categoryColor } from '../theme/theme';
import { useApp } from '../context/AppContext';
import { relativeDay, timeLabel, isOngoing, isAllDayAnchor, formatShortDate, formatTime, toDateString } from '../utils/dates';

function EventCard({ event }) {
  const router = useRouter();
  const { savedIds, toggleSaved, scale } = useApp();
  const saved = savedIds.includes(event.id);
  const accent = categoryColor(event.category);
  const thumbSize = Math.round(64 * Math.min(scale, 1.2)); // scale with Text Size like the date chip
  // Pop the heart on save (the app's most-repeated delight moment).
  const heartScale = useRef(new Animated.Value(1)).current;
  const prevSaved = useRef(saved);
  useEffect(() => {
    if (saved && !prevSaved.current) {
      Animated.sequence([
        Animated.timing(heartScale, { toValue: 1.3, duration: 120, useNativeDriver: true }),
        Animated.spring(heartScale, { toValue: 1, friction: 4, useNativeDriver: true }),
      ]).start();
    }
    prevSaved.current = saved;
  }, [saved, heartScale]);

  // Multi-day events already running show "Happening now · through <end>" instead
  // of their (past) start date, which otherwise reads as a stale listing. A
  // multi-day event that hasn't hit day two yet ("Dino-Mite Kids WEEK", Mon–Fri)
  // shows its span too — bare clock times read like a finished single-day event.
  const ongoing = isOngoing(event.start, event.end);
  const multiDay = !!event.end && toDateString(event.start) !== toDateString(event.end);

  return (
    <View style={[styles.card, event.featured && styles.cardFeatured]}>
      <Pressable
        onPress={() => router.push(`/event/${event.id}`)}
        style={({ pressed }) => [styles.tappable, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${event.title}, ${relativeDay(event.start)}, at ${event.venue}`}
      >
        {event.imageUrl ? (
          <FadeInImage source={{ uri: event.imageUrl }} style={[styles.thumb, { width: thumbSize, height: thumbSize }]} resizeMode="cover" />
        ) : (
          <DateChip date={ongoing ? event.end : event.start} accent={accent} scale={scale} ongoing={ongoing} />
        )}

        <View style={styles.body}>
          <View style={styles.topRow}>
            <Pill label={(event.category || 'Community').toUpperCase()} color={accent} bg={accent + '18'} />
            {event.featured ? (
              <Pill label="FEATURED" color={colors.accent} bg={colors.accentLight} icon="star" />
            ) : null}
          </View>

          <ThemedText size="subtitle" weight="bold" numberOfLines={2}>
            {event.title}
          </ThemedText>

          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={15 * scale} color={colors.textMuted} />
            <ThemedText size="small" color={colors.textMuted}>
              {ongoing
                ? `Happening now · through ${formatShortDate(event.end)}`
                : multiDay
                  ? `${relativeDay(event.start)}${isAllDayAnchor(event.start, null) ? '' : ` ${formatTime(event.start)}`} · through ${formatShortDate(event.end)}`
                  : `${relativeDay(event.start)} · ${timeLabel(event.start, event.end)}`}
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
        style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={saved ? 'Remove from saved' : 'Save event'}
      >
        <Animated.View style={{ transform: [{ scale: heartScale }] }}>
          <Ionicons
            name={saved ? 'heart' : 'heart-outline'}
            size={26 * Math.min(scale, 1.3)}
            color={saved ? colors.danger : colors.textMuted}
          />
        </Animated.View>
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
    backgroundColor: colors.featuredBg,
  },
  tappable: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
    borderRadius: radius.md,
    alignItems: 'flex-start',
  },
  pressed: { opacity: 0.6 },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  body: { flex: 1, gap: spacing.xs },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  saveBtn: {
    alignSelf: 'flex-start',
    padding: spacing.xs,
  },
});

// Memoized: cards only re-render when their event prop changes, so typing in
// search (which rebuilds the list) doesn't re-render every visible card.
export default React.memo(EventCard);
