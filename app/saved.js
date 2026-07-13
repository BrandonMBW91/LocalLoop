import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, Share } from 'react-native';
import ThemedText from '../src/components/ThemedText';
import EventCard from '../src/components/EventCard';
import SkeletonList from '../src/components/SkeletonCard';
import EmptyState from '../src/components/EmptyState';
import { useApp } from '../src/context/AppContext';
import { fetchEventsByIds } from '../src/lib/db';
import { shareAppMessage } from '../src/lib/links';
import { getEventById } from '../src/data/events';
import { colors, spacing } from '../src/theme/theme';

export default function SavedScreen() {
  const { savedIds, backendEnabled, submittedEvents } = useApp();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const onShareApp = () => {
    Share.share({ message: shareAppMessage() }).catch(() => {});
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (backendEnabled) {
        setEvents(await fetchEventsByIds(savedIds));
      } else {
        setEvents(savedIds.map((id) => getEventById(id, submittedEvents)).filter(Boolean));
      }
    } catch (e) {
      // Fall back to whatever we can resolve locally.
      setEvents(savedIds.map((id) => getEventById(id, submittedEvents)).filter(Boolean));
    } finally {
      setLoading(false);
    }
  }, [savedIds, backendEnabled, submittedEvents]);

  useEffect(() => {
    load();
  }, [load]);

  // Only show events that are still saved (unsaving removes them instantly).
  const visible = events.filter((e) => savedIds.includes(e.id));

  if (loading && events.length === 0) {
    return <SkeletonList count={4} />;
  }

  if (visible.length === 0) {
    return (
      <EmptyState
        icon="heart-outline"
        title="No saved events yet"
        body="Tap the heart on any event to save it here, then share Local Loop so friends can find things to do too."
        actionLabel="Tell a friend"
        onAction={onShareApp}
        actionIcon="share"
        accent={colors.primary}
      />
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingVertical: spacing.sm, paddingBottom: spacing.xxl }}
    >
      <ThemedText size="small" color={colors.textMuted} style={styles.count}>
        {visible.length} saved {visible.length === 1 ? 'event' : 'events'}
      </ThemedText>
      {visible.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.background,
  },
  count: {
    marginLeft: spacing.md + spacing.xs,
    marginBottom: spacing.xs,
  },
});
