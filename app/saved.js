import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, Share } from 'react-native';
import ThemedText from '../src/components/ThemedText';
import EventCard from '../src/components/EventCard';
import GarageSaleCard from '../src/components/GarageSaleCard';
import SkeletonList from '../src/components/SkeletonCard';
import EmptyState from '../src/components/EmptyState';
import { useApp } from '../src/context/AppContext';
import { fetchEventsByIds, fetchGarageSalesByIds } from '../src/lib/db';
import { shareAppMessage } from '../src/lib/links';
import { getEventById } from '../src/data/events';
import { colors, spacing } from '../src/theme/theme';

export default function SavedScreen() {
  const { savedIds, savedSaleIds, backendEnabled, submittedEvents, findGarageSaleById } = useApp();
  const [events, setEvents] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);

  const onShareApp = () => {
    Share.share({ message: shareAppMessage() }).catch(() => {});
  };

  const load = useCallback(async () => {
    setLoading(true);
    // Resolve saved ids to full objects; saved items can be from any city, so we
    // fetch by id when the backend is on and fall back to whatever is cached.
    const localEvents = () => savedIds.map((id) => getEventById(id, submittedEvents)).filter(Boolean);
    const localSales = () => savedSaleIds.map((id) => findGarageSaleById(id)).filter(Boolean);
    try {
      if (backendEnabled) {
        const [ev, sa] = await Promise.all([
          fetchEventsByIds(savedIds),
          fetchGarageSalesByIds(savedSaleIds),
        ]);
        setEvents(ev);
        setSales(sa);
      } else {
        setEvents(localEvents());
        setSales(localSales());
      }
    } catch (e) {
      setEvents(localEvents());
      setSales(localSales());
    } finally {
      setLoading(false);
    }
  }, [savedIds, savedSaleIds, backendEnabled, submittedEvents, findGarageSaleById]);

  useEffect(() => {
    load();
  }, [load]);

  // Only show items that are still saved (unsaving removes them instantly).
  const visibleEvents = events.filter((e) => savedIds.includes(e.id));
  const visibleSales = sales.filter((s) => savedSaleIds.includes(s.id));
  const total = visibleEvents.length + visibleSales.length;

  if (loading && total === 0) {
    return <SkeletonList count={4} />;
  }

  if (total === 0) {
    return (
      <EmptyState
        icon="heart-outline"
        title="Nothing saved yet"
        body="Tap the heart on any event or garage sale to save it here, then share Local Loop so friends can find things to do too."
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
      {visibleEvents.length > 0 ? (
        <View>
          <ThemedText size="small" weight="bold" color={colors.textMuted} style={styles.header}>
            Events ({visibleEvents.length})
          </ThemedText>
          {visibleEvents.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </View>
      ) : null}

      {visibleSales.length > 0 ? (
        <View>
          <ThemedText size="small" weight="bold" color={colors.textMuted} style={styles.header}>
            Garage sales ({visibleSales.length})
          </ThemedText>
          {visibleSales.map((sale) => (
            <GarageSaleCard key={sale.id} sale={sale} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    marginLeft: spacing.md + spacing.xs,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
