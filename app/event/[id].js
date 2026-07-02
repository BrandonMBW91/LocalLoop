import React, { useEffect, useRef } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Linking, Platform, Share, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ThemedText from '../../src/components/ThemedText';
import AdBanner from '../../src/components/AdBanner';
import ReportButton from '../../src/components/ReportButton';
import FeatureButton from '../../src/components/FeatureButton';
import { useApp } from '../../src/context/AppContext';
import { recordView } from '../../src/lib/db';
import { colors, spacing, radius, categoryColor, categoryIcon } from '../../src/theme/theme';
import { formatLongDate, timeRange } from '../../src/utils/dates';
import { addToCalendarUrl } from '../../src/utils/calendar';
import { SHARE_FOOTER } from '../../src/lib/links';

function InfoRow({ icon, label, value, onPress }) {
  const Wrap = onPress ? Pressable : View;
  return (
    <Wrap style={styles.infoRow} onPress={onPress}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText size="small" color={colors.textMuted}>
          {label}
        </ThemedText>
        <ThemedText size="body" weight="semibold" color={onPress ? colors.primary : colors.text}>
          {value}
        </ThemedText>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={20} color={colors.textMuted} /> : null}
    </Wrap>
  );
}

export default function EventDetailScreen() {
  const { id: rawId } = useLocalSearchParams();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const router = useRouter();
  const { findEventById, savedIds, toggleSaved, isFollowing, toggleFollow, backendEnabled, isAdmin, logEvent } = useApp();
  const event = findEventById(id);

  // Record the view once per id, but only after the event has resolved, so the
  // logged category isn't undefined on the first-render race.
  const viewedRef = useRef(null);
  useEffect(() => {
    if (backendEnabled && id && event && viewedRef.current !== id) {
      viewedRef.current = id;
      recordView('event', id);
      logEvent('view_event', { category: event.category });
    }
  }, [id, backendEnabled, event, recordView, logEvent]);

  if (!event) {
    return (
      <View style={styles.notFound}>
        <ThemedText size="title" weight="bold">Event not found</ThemedText>
        <Pressable style={styles.primaryBtn} onPress={() => router.back()}>
          <ThemedText size="body" weight="bold" color={colors.textInverse}>Go Back</ThemedText>
        </Pressable>
      </View>
    );
  }

  const accent = categoryColor(event.category);
  const saved = savedIds.includes(event.id);
  const following = isFollowing(event.venue);

  const openMaps = () => {
    const loc = (event.address || event.venue || '').trim();
    if (!loc) return;
    const q = encodeURIComponent(loc);
    const url = Platform.select({
      ios: `maps:0,0?q=${q}`,
      android: `geo:0,0?q=${q}`,
      default: `https://maps.google.com/?q=${q}`,
    });
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://maps.google.com/?q=${q}`)
    );
  };

  const onShare = () => {
    Share.share({
      message: `${event.title}\n${formatLongDate(event.start)} · ${timeRange(event.start, event.end)}\n${[event.venue, event.address].filter(Boolean).join(', ')}${SHARE_FOOTER}`,
    }).catch(() => {});
  };

  const onAddToCalendar = () => {
    const url = addToCalendarUrl({
      title: event.title,
      start: event.start,
      end: event.end,
      location: [event.venue, event.address].filter(Boolean).join(', '),
      details: event.description,
    });
    Linking.openURL(url).catch(() => {});
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
      {/* Hero — real artwork when we have it, otherwise a category icon */}
      {event.imageUrl ? (
        <Image source={{ uri: event.imageUrl }} style={styles.heroImage} resizeMode="cover" />
      ) : (
        <View style={[styles.hero, { backgroundColor: accent + '1A' }]}>
          <Ionicons name={categoryIcon(event.category)} size={72} color={accent} />
        </View>
      )}
      <View style={styles.heroBadges}>
        <View style={[styles.catBadge, { backgroundColor: accent }]}>
          <ThemedText size="small" weight="bold" color={colors.textInverse}>
            {event.category}
          </ThemedText>
        </View>
        {event.pending ? (
          <View style={styles.pendingBadge}>
            <ThemedText size="tiny" weight="bold" color={colors.accent}>
              ⏳ PENDING REVIEW
            </ThemedText>
          </View>
        ) : null}
      </View>

      <View style={styles.content}>
        <ThemedText size="large" weight="bold">{event.title}</ThemedText>
        {event.featured ? (
          <View style={styles.featuredRow}>
            <Ionicons name="star" size={16} color={colors.accent} />
            <ThemedText size="small" weight="bold" color={colors.accent}>
              Featured Event
            </ThemedText>
          </View>
        ) : null}
        {isAdmin ? (
          <View style={styles.featuredRow}>
            <Ionicons name="eye" size={16} color={colors.textMuted} />
            <ThemedText size="small" color={colors.textMuted}>
              {event.viewCount ?? 0} views
            </ThemedText>
          </View>
        ) : null}

        {/* Action buttons */}
        <View style={styles.actions}>
          <Pressable
            style={[styles.actionBtn, saved && { backgroundColor: colors.danger }]}
            onPress={() => toggleSaved(event.id, event)}
          >
            <Ionicons
              name={saved ? 'heart' : 'heart-outline'}
              size={22}
              color={saved ? colors.textInverse : colors.primary}
            />
            <ThemedText size="body" weight="bold" color={saved ? colors.textInverse : colors.primary}>
              {saved ? 'Saved' : 'Save'}
            </ThemedText>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={onShare}>
            <Ionicons name="share-outline" size={22} color={colors.primary} />
            <ThemedText size="body" weight="bold" color={colors.primary}>
              Share
            </ThemedText>
          </Pressable>
        </View>

        {event.ticketUrl ? (
          <Pressable
            style={styles.ticketsBtn}
            onPress={() => Linking.openURL(event.ticketUrl).catch(() => {})}
            accessibilityRole="link"
            accessibilityLabel="Get tickets"
          >
            <Ionicons name="ticket-outline" size={22} color={colors.textInverse} />
            <ThemedText size="body" weight="bold" color={colors.textInverse}>
              {/ticket|\$/i.test(event.price || '') ? 'Get Tickets' : 'More Info & Register'}
            </ThemedText>
            <Ionicons name="open-outline" size={18} color={colors.textInverse} />
          </Pressable>
        ) : null}

        <Pressable style={styles.calendarBtn} onPress={onAddToCalendar}>
          <Ionicons name="calendar-outline" size={22} color={colors.textInverse} />
          <ThemedText size="body" weight="bold" color={colors.textInverse}>
            Add to my Calendar
          </ThemedText>
        </Pressable>

        {/* Info rows */}
        <View style={styles.infoCard}>
          <InfoRow
            icon="calendar"
            label="When"
            value={`${formatLongDate(event.start)}\n${timeRange(event.start, event.end)}`}
          />
          <View style={styles.divider} />
          <InfoRow
            icon="location"
            label="Where (tap for directions)"
            value={`${event.venue}\n${event.address}`}
            onPress={openMaps}
          />
          <View style={styles.divider} />
          <InfoRow icon="pricetag" label="Cost" value={event.price} />
          <View style={styles.divider} />
          <InfoRow icon="people" label="Hosted by" value={event.host} />
        </View>

        {/* Follow this venue — surfaces its events under the "Following" filter */}
        {event.venue ? (
          <Pressable
            style={[styles.followBtn, following && styles.followingBtn]}
            onPress={() => toggleFollow(event.venue)}
            accessibilityRole="button"
            accessibilityLabel={following ? `Unfollow ${event.venue}` : `Follow ${event.venue}`}
          >
            <Ionicons
              name={following ? 'notifications' : 'notifications-outline'}
              size={20}
              color={following ? colors.textInverse : colors.primary}
            />
            <ThemedText
              size="body"
              weight="bold"
              color={following ? colors.textInverse : colors.primary}
              numberOfLines={1}
              style={{ flexShrink: 1 }}
            >
              {following ? `Following ${event.venue}` : `Follow ${event.venue}`}
            </ThemedText>
          </Pressable>
        ) : null}

        {/* Description */}
        <ThemedText size="subtitle" weight="bold" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
          About this event
        </ThemedText>
        <ThemedText size="body" color={colors.text} style={{ lineHeight: 28 }}>
          {event.description}
        </ThemedText>
      </View>

      <FeatureButton kind="event" id={event.id} featured={event.featured} featuredUntil={event.featuredUntil} />
      <ReportButton kind="event" id={event.id} />
      <AdBanner />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  followBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    minHeight: 50,
  },
  followingBtn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  heroImage: {
    width: '100%',
    height: 200,
    backgroundColor: colors.surfaceAlt,
  },
  heroBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  catBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  pendingBadge: {
    backgroundColor: colors.accentLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  content: { padding: spacing.md },
  featuredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  calendarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    minHeight: 52,
  },
  ticketsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    minHeight: 52,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    minHeight: 52,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.lg,
    paddingVertical: spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  infoIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.md + 40 + spacing.md,
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    backgroundColor: colors.background,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
});
