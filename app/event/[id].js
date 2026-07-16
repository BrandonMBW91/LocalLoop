import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Linking, Platform, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ThemedText from '../../src/components/ThemedText';
import FadeInImage from '../../src/components/FadeInImage';
import AdBanner from '../../src/components/AdBanner';
import DetailSkeleton from '../../src/components/DetailSkeleton';
import ReportButton from '../../src/components/ReportButton';
import FeatureButton from '../../src/components/FeatureButton';
import { useApp } from '../../src/context/AppContext';
import { recordView, fetchOneById, toggleRsvp, fetchRsvpCounts } from '../../src/lib/db';
import { colors, spacing, radius, categoryColor, categoryIcon } from '../../src/theme/theme';
import { formatLongDate, timeLabel, isOngoing, formatShortDate, toDateString } from '../../src/utils/dates';
import { placeLine, placeMultiline, isPlaceholderVenue } from '../../src/utils/place';
import { addToCalendarUrl } from '../../src/utils/calendar';
import { shareUrl, shareFooter } from '../../src/lib/links';

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
  const { findEventById, savedIds, toggleSaved, isFollowing, toggleFollow, backendEnabled, isAdmin, noTrack, logEvent, deviceId } = useApp();
  const cached = findEventById(id);
  // Deep link (localloop.io/event/<id>) may reference an event outside the
  // loaded city — fetch it directly when the cache misses.
  const [fetched, setFetched] = useState(null);
  const [fetching, setFetching] = useState(!cached && backendEnabled && !!id);
  const [heroFailed, setHeroFailed] = useState(false); // fall back to the category icon on a 404/timeout
  useEffect(() => {
    if (!cached && backendEnabled && id) {
      let ok = true;
      setFetching(true);
      fetchOneById('event', id)
        .then((e) => { if (ok) { setFetched(e); setFetching(false); } })
        .catch(() => { if (ok) setFetching(false); });
      return () => { ok = false; };
    }
    setFetching(false);
  }, [cached, backendEnabled, id]);
  const event = cached || fetched;

  // Record the view once per id, but only after the event has resolved, so the
  // logged category isn't undefined on the first-render race.
  const viewedRef = useRef(null);
  useEffect(() => {
    if (backendEnabled && id && event && viewedRef.current !== id && !noTrack) {
      viewedRef.current = id;
      recordView('event', id); // owner views excluded — they'd inflate advertiser-facing numbers
      logEvent('view_event', { category: event.category });
    }
  }, [id, backendEnabled, event, noTrack, recordView, logEvent]);

  // "I'm going" RSVP — public count as social proof, one tap to toggle. The
  // count loads from the backend; taps update optimistically and reconcile with
  // the server's returned total. Fails soft (button just won't change on error).
  // IMPORTANT: this and EVERY hook must stay ABOVE the `if (!event)` early return
  // below. If the event is deleted while this screen is open, `event` flips from
  // present to null on the next render; a hook placed after the early return
  // would then stop being called, changing the hook count between renders and
  // crashing with "rendered fewer hooks than expected."
  const [rsvp, setRsvp] = useState({ n: 0, mine: false, loaded: false });
  useEffect(() => {
    let ok = true;
    if (backendEnabled && event?.id && !isAdmin) {
      fetchRsvpCounts('event', [event.id], deviceId).then((map) => {
        if (!ok) return;
        const r = map[event.id];
        setRsvp({ n: r?.n || 0, mine: Boolean(r?.mine), loaded: true });
      });
    }
    return () => { ok = false; };
  }, [backendEnabled, event?.id, isAdmin, deviceId]);

  if (!event) {
    if (fetching) return <DetailSkeleton tint={colors.primaryLight} />;
    return (
      <View style={styles.notFound}>
        <ThemedText size="title" weight="bold">Event not found</ThemedText>
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center', paddingHorizontal: spacing.lg }}>
          This event may have ended or been taken down.
        </ThemedText>
        <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <ThemedText size="body" weight="bold" color={colors.textInverse}>Go Back</ThemedText>
        </Pressable>
      </View>
    );
  }

  const accent = categoryColor(event.category);
  const saved = savedIds.includes(event.id);
  const following = isFollowing(event.venue);

  const onRsvp = async () => {
    if (!deviceId || !event?.id) return;
    const optimistic = { n: rsvp.n + (rsvp.mine ? -1 : 1), mine: !rsvp.mine, loaded: true };
    setRsvp(optimistic);
    logEvent(optimistic.mine ? 'rsvp_going' : 'rsvp_undo', {});
    const total = await toggleRsvp('event', event.id, deviceId);
    if (typeof total === 'number') setRsvp((cur) => ({ ...cur, n: total }));
  };

  const openMaps = () => {
    // Never launch a maps search for a feed placeholder ("Virtual", "See venue").
    const loc = (event.address || (isPlaceholderVenue(event.venue) ? '' : event.venue) || '').trim();
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

  // One "when" everywhere (When field, share text). A multi-day event shows its
  // full span — "Mon, Jul 13 through Fri, Jul 17 · 7 AM to 2:30 PM" — instead of
  // start-day clock times that read like a finished single-day event.
  const whenLabel = () => {
    const multiDay = event.end && toDateString(event.start) !== toDateString(event.end);
    if (!multiDay) return `${formatLongDate(event.start)} · ${timeLabel(event.start, event.end)}`;
    const span = `${formatShortDate(event.start)} through ${formatShortDate(event.end)}`;
    return isOngoing(event.start, event.end)
      ? `Happening now · ${span}`
      : `${span} · ${timeLabel(event.start, event.end)}`;
  };

  const onShare = () => {
    Share.share({
      message: `${event.title}\n${whenLabel()}\n${placeLine(event.venue, event.address)}${shareFooter(shareUrl('event', id))}`,
      url: shareUrl('event', id), // iOS uses this to unfurl a rich preview card
    }).catch(() => {});
  };

  const onAddToCalendar = () => {
    const url = addToCalendarUrl({
      title: event.title,
      start: event.start,
      end: event.end,
      location: placeLine(event.venue, event.address),
      details: event.description,
    });
    Linking.openURL(url).catch(() => {});
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
      {/* Hero — real artwork when we have it, otherwise a category icon */}
      {event.imageUrl && !heroFailed ? (
        <FadeInImage
          source={{ uri: event.imageUrl }}
          style={styles.heroImage}
          resizeMode="cover"
          onError={() => setHeroFailed(true)}
        />
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
            style={({ pressed }) => [styles.actionBtn, saved && { backgroundColor: colors.danger }, pressed && { opacity: 0.85 }]}
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
          <Pressable style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.85 }]} onPress={onShare}>
            <Ionicons name="share-outline" size={22} color={colors.primary} />
            <ThemedText size="body" weight="bold" color={colors.primary}>
              Share
            </ThemedText>
          </Pressable>
        </View>
        <ThemedText size="small" color={colors.textMuted} style={{ textAlign: 'center', marginTop: spacing.xs }}>
          {saved ? "Saved. We'll remind you before it starts." : "Save it and we'll remind you before it starts."}
        </ThemedText>

        {/* "I'm going" — social proof + a reason for organizers to point people here */}
        {backendEnabled && !isAdmin ? (
          <Pressable
            style={({ pressed }) => [styles.rsvpBtn, rsvp.mine && { backgroundColor: colors.success, borderColor: colors.success }, pressed && { opacity: 0.85 }]}
            onPress={onRsvp}
            accessibilityRole="button"
            accessibilityLabel={rsvp.mine ? "You're going. Tap to undo." : "Mark that you're going"}
          >
            <Ionicons
              name={rsvp.mine ? 'checkmark-circle' : 'checkmark-circle-outline'}
              size={22}
              color={rsvp.mine ? colors.textInverse : colors.success}
            />
            <ThemedText size="body" weight="bold" color={rsvp.mine ? colors.textInverse : colors.success}>
              {rsvp.mine ? "You're going" : "I'm going"}
            </ThemedText>
            {rsvp.n > 0 ? (
              <View style={[styles.rsvpCount, rsvp.mine && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
                <ThemedText size="small" weight="bold" color={rsvp.mine ? colors.textInverse : colors.success}>
                  {rsvp.n}
                </ThemedText>
              </View>
            ) : null}
          </Pressable>
        ) : null}

        {event.ticketUrl ? (
          <Pressable
            style={({ pressed }) => [styles.ticketsBtn, pressed && { opacity: 0.85 }]}
            onPress={() => { const u = event.ticketUrl || ''; if (/^(https:\/\/|tel:)/i.test(u)) Linking.openURL(u).catch(() => {}); }}
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

        <Pressable style={({ pressed }) => [styles.calendarBtn, pressed && { opacity: 0.85 }]} onPress={onAddToCalendar}>
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
            value={whenLabel().replace(' · ', '\n')}
          />
          <View style={styles.divider} />
          <InfoRow
            icon="location"
            label="Where (tap for directions)"
            value={placeMultiline(event.venue, event.address)}
            onPress={openMaps}
          />
          <View style={styles.divider} />
          <InfoRow icon="pricetag" label="Cost" value={event.price} />
          <View style={styles.divider} />
          <InfoRow icon="people" label="Hosted by" value={event.host} />
        </View>

        {/* Follow this venue — surfaces its events under the "Following" filter.
            Hidden for feed placeholders — "Follow Virtual" is meaningless. */}
        {event.venue && !isPlaceholderVenue(event.venue) ? (
          <Pressable
            style={({ pressed }) => [styles.followBtn, following && styles.followingBtn, pressed && { opacity: 0.85 }]}
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

      {/* Admin: edit this event's fields. Hidden for feed-ingested rows — the
          nightly aggregator upsert would overwrite edits (the edit screen
          explains this too, and RLS enforces admin-only server-side). */}
      {/* `cached` required: the edit screen resolves via findEventById (the
          loaded town), so an out-of-town event reached by deep link would
          dead-end at its not-found guard. */}
      {isAdmin && cached && !event.sourceUid ? (
        <Pressable
          style={({ pressed }) => [styles.adminEditBtn, pressed && { opacity: 0.85 }]}
          onPress={() => router.push({ pathname: '/event/edit', params: { id: event.id } })}
          accessibilityRole="button"
          accessibilityLabel="Edit this event"
        >
          <Ionicons name="create-outline" size={20} color={colors.primary} />
          <ThemedText size="body" weight="bold" color={colors.primary}>Edit Event</ThemedText>
        </Pressable>
      ) : null}
      <FeatureButton kind="event" id={event.id} featured={event.featured} featuredUntil={event.featuredUntil} />
      <ReportButton kind="event" id={event.id} />
      <AdBanner />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  adminEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.primary,
    minHeight: 52,
  },
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
  rsvpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.success,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    minHeight: 52,
    marginTop: spacing.sm,
  },
  rsvpCount: {
    backgroundColor: colors.successBg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    minWidth: 24,
    alignItems: 'center',
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
