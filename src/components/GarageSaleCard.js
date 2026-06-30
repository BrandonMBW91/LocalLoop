import React from 'react';
import { View, StyleSheet, Pressable, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ThemedText from './ThemedText';
import DateChip from './DateChip';
import { colors, spacing, radius } from '../theme/theme';
import { useApp } from '../context/AppContext';
import { dateRangeLabel, daysFromNow } from '../utils/dates';

// Parse a "10:00 AM" / "2:00 PM" clock string into minutes since midnight.
// Returns null when it can't be parsed (treated as "hours unknown").
function clockToMinutes(s) {
  const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3] ? m[3].toUpperCase() : null;
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

// Where the clock is relative to a sale's posted daily hours, on a sale day:
// 'live' (open now), 'before' (opens later today), 'after' (closed for today).
// Falls back to 'live' when hours are missing, matching the old date-only badge.
function dailyHourStatus(sale, now) {
  const open = clockToMinutes(sale.dailyStart);
  const close = clockToMinutes(sale.dailyEnd);
  if (open == null || close == null) return 'live';
  const mins = now.getHours() * 60 + now.getMinutes();
  if (close <= open) return mins >= open || mins < close ? 'live' : mins < open ? 'before' : 'after';
  if (mins < open) return 'before';
  if (mins >= close) return 'after';
  return 'live';
}

function whenBadge(sale, now = new Date()) {
  const startIn = daysFromNow(sale.start);
  const endIn = daysFromNow(sale.end || sale.start);
  if (startIn <= 0 && endIn >= 0) {
    // Today is a sale day — only say "now" during the posted hours.
    const status = dailyHourStatus(sale, now);
    if (status === 'live') return 'HAPPENING NOW';
    if (status === 'before') return 'TODAY';
    return endIn >= 1 ? 'THIS WEEK' : null; // closed for today; more days ahead?
  }
  if (startIn === 1) return 'TOMORROW';
  if (startIn > 1 && startIn <= 7) return 'THIS WEEK';
  return null;
}

function GarageSaleCard({ sale }) {
  const router = useRouter();
  const { scale } = useApp();
  const accent = colors.garageSale;
  const badge = whenBadge(sale);
  const thumb = Math.round(62 * Math.min(scale, 1.2));

  return (
    <Pressable
      onPress={() => router.push(`/garage-sale/${sale.id}`)}
      style={({ pressed }) => [styles.card, sale.featured && styles.cardFeatured, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${sale.title}, ${dateRangeLabel(sale.start, sale.end)}, at ${sale.address}`}
    >
      {sale.images?.length ? (
        <Image source={{ uri: sale.images[0] }} style={[styles.thumb, { width: thumb, height: thumb }]} resizeMode="cover" />
      ) : (
        <DateChip date={sale.start} accent={accent} scale={scale} />
      )}

      <View style={styles.body}>
        <View style={styles.topRow}>
          <View style={[styles.pill, { backgroundColor: accent + '18' }]}>
            <ThemedText size="tiny" weight="bold" color={accent}>
              {sale.type.toUpperCase()}
            </ThemedText>
          </View>
          {sale.featured ? (
            <View style={styles.featuredPill}>
              <Ionicons name="star" size={11} color={colors.accent} />
              <ThemedText size="tiny" weight="bold" color={colors.accent}>FEATURED</ThemedText>
            </View>
          ) : null}
          {badge ? (
            <View style={styles.whenPill}>
              <ThemedText size="tiny" weight="bold" color={colors.success}>{badge}</ThemedText>
            </View>
          ) : null}
        </View>

        <ThemedText size="subtitle" weight="bold" numberOfLines={2}>
          {sale.title}
        </ThemedText>

        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={15 * scale} color={colors.textMuted} />
          <ThemedText size="small" color={colors.textMuted}>
            {dateRangeLabel(sale.start, sale.end)} · {sale.dailyStart}–{sale.dailyEnd}
          </ThemedText>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={15 * scale} color={colors.textMuted} />
          <ThemedText size="small" color={colors.textMuted} numberOfLines={1}>
            {sale.address}
          </ThemedText>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="person-circle" size={15 * scale} color={accent} />
          <ThemedText size="tiny" color={accent} weight="bold">Posted by a neighbor</ThemedText>
        </View>

        {sale.items?.length ? (
          <View style={styles.tagRow}>
            {sale.items.slice(0, 3).map((item, i) => (
              <View key={`${item}-${i}`} style={styles.tag}>
                <ThemedText size="tiny" color={accent} weight="medium">{item}</ThemedText>
              </View>
            ))}
            {sale.items.length > 3 ? (
              <ThemedText size="tiny" color={colors.textMuted}>+{sale.items.length - 3} more</ThemedText>
            ) : null}
          </View>
        ) : null}
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
  thumb: {
    borderRadius: radius.md,
    backgroundColor: colors.garageSaleLight,
  },
  body: { flex: 1, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pill: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 2 },
  whenPill: {
    backgroundColor: '#E5F2E8',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
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
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tagRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  tag: {
    backgroundColor: colors.garageSaleLight,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});

export default React.memo(GarageSaleCard);
