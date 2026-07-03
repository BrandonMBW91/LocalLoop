import React, { useMemo, useState, useDeferredValue } from 'react';
import {
  View,
  SectionList,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ThemedText from '../../src/components/ThemedText';
import EventCard from '../../src/components/EventCard';
import CategoryChip from '../../src/components/CategoryChip';
import AdBanner from '../../src/components/AdBanner';
import EditorPickBanner from '../../src/components/EditorPickBanner';
import SectionHeader from '../../src/components/SectionHeader';
import SkeletonList from '../../src/components/SkeletonCard';
import EmptyState from '../../src/components/EmptyState';
import CityHeaderControl from '../../src/components/CityHeaderControl';
import { useApp } from '../../src/context/AppContext';
import { CATEGORIES } from '../../src/data/events';
import { daysFromNow, isThisWeekend } from '../../src/utils/dates';
import { buildTimeSections } from '../../src/utils/grouping';
import { colors, spacing, radius, baseFont } from '../../src/theme/theme';

export default function EventsScreen() {
  const router = useRouter();
  const { city, scale, events, deals, sponsors, editorPick, interests, follows, loadingData, loadError, refresh, backendEnabled, signedIn, logEvent } = useApp();

  const goPost = (path) => {
    if (backendEnabled && !signedIn) {
      router.push({ pathname: '/sign-in', params: { next: path } });
    } else {
      router.push(path);
    }
  };
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query); // keep typing smooth on big lists
  const [activeCat, setActiveCat] = useState('All');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  // When the user is actively filtering an existing list, the empty state
  // should offer to clear filters rather than tell them to "be the first".
  const isFiltering = activeCat !== 'All' || query.trim().length > 0;
  const clearFilters = () => {
    setActiveCat('All');
    setQuery('');
  };

  const cityEvents = events;

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return cityEvents.filter((e) => {
      const matchesFilter =
        activeCat === 'All'
          ? true
          : activeCat === 'Today'
          ? daysFromNow(e.start) === 0
          : activeCat === 'Weekend'
          ? isThisWeekend(e.start)
          : activeCat === 'Free'
          ? /free/i.test(e.price || '')
          : activeCat === 'For You'
          ? interests.length === 0 || interests.includes(e.category)
          : activeCat === 'Following'
          ? follows.includes(e.venue)
          : e.category === activeCat;
      const matchesQuery =
        !q ||
        e.title.toLowerCase().includes(q) ||
        e.venue.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [cityEvents, deferredQuery, activeCat, interests, follows]);

  // Group into time buckets (Featured pinned first), with ads interleaved.
  const sections = useMemo(
    () =>
      buildTimeSections({
        items: filtered,
        getDays: (e) => daysFromNow(e.start),
        isFeatured: (e) => e.featured,
        toRenderItem: (e) => ({ type: 'event', event: e, key: e.id }),
        injectAds: sponsors.length > 0,
      }),
    [filtered, sponsors.length]
  );

  return (
    <View style={styles.screen}>
      {/* City header — shared control (Calendar + Map + Change) */}
      <CityHeaderControl label="SHOWING EVENTS IN" showTagline showViews />

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={22} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search events..."
          placeholderTextColor={colors.textMuted}
          style={[styles.searchInput, { fontSize: Math.round(baseFont.body * scale) }]}
          accessibilityLabel="Search events"
          returnKeyType="search"
          onSubmitEditing={() => query.trim() && logEvent('search', { term: query.trim().slice(0, 40) })}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={22} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {/* Category filter */}
      <View style={styles.filterRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterContent}
        >
          <CategoryChip
            label="All"
            selected={activeCat === 'All'}
            onPress={() => setActiveCat('All')}
          />
          {interests.length > 0 ? (
            <CategoryChip
              label="For You"
              selected={activeCat === 'For You'}
              onPress={() => setActiveCat('For You')}
            />
          ) : null}
          <CategoryChip
            label="Today"
            selected={activeCat === 'Today'}
            onPress={() => setActiveCat('Today')}
          />
          <CategoryChip
            label="Weekend"
            selected={activeCat === 'Weekend'}
            onPress={() => setActiveCat('Weekend')}
          />
          <CategoryChip
            label="Free"
            selected={activeCat === 'Free'}
            onPress={() => setActiveCat('Free')}
          />
          {follows.length > 0 ? (
            <CategoryChip
              label="Following"
              selected={activeCat === 'Following'}
              onPress={() => setActiveCat('Following')}
            />
          ) : null}
          {CATEGORIES.map((cat) => (
            <CategoryChip
              key={cat}
              label={cat}
              selected={activeCat === cat}
              onPress={() => setActiveCat(cat)}
            />
          ))}
        </ScrollView>
      </View>

      {/* Events list — grouped by time with sticky headers */}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) =>
          item.type === 'ad' ? <AdBanner index={item.adIndex} /> : <EventCard event={item.event} />
        }
        renderSectionHeader={({ section }) => (
          <SectionHeader title={section.title} count={section.count} />
        )}
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <>
            {loadError ? (
              <View style={styles.offlineBanner}>
                <Ionicons name="cloud-offline-outline" size={18} color={colors.accent} />
                <ThemedText size="small" color={colors.accent} style={{ flex: 1 }}>
                  Couldn't refresh. Showing saved listings. Pull down to try again.
                </ThemedText>
              </View>
            ) : null}
            <EditorPickBanner pick={editorPick} />
            {deals.length > 0 ? (
              <Pressable style={styles.dealsBanner} onPress={() => router.push('/deals')}>
                <Ionicons name="pricetags" size={20} color={colors.accent} />
                <ThemedText size="body" weight="bold" color={colors.accent} style={{ flex: 1 }}>
                  {deals.length} local {deals.length === 1 ? 'deal' : 'deals'} in {city.name}
                </ThemedText>
                <Ionicons name="chevron-forward" size={20} color={colors.accent} />
              </Pressable>
            ) : null}
            {loadingData ? null : (
              <ThemedText size="small" color={colors.textMuted} style={styles.countLabel}>
                {filtered.length} {filtered.length === 1 ? 'event' : 'events'} found
              </ThemedText>
            )}
          </>
        }
        ListEmptyComponent={
          loadingData ? (
            <SkeletonList />
          ) : isFiltering ? (
            <EmptyState
              icon="search"
              title="No events match that filter"
              body="Try a different category or search, or clear your filters to see everything."
              actionLabel="Clear filters"
              onAction={clearFilters}
            />
          ) : (
            <EmptyState
              icon="search"
              title="No events found"
              body="Nothing is posted here yet. Be the first to add one!"
              actionLabel="Submit an Event"
              onAction={() => goPost('/event/new')}
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentLight,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 52,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    paddingVertical: 12,
  },
  filterRow: {
    marginTop: spacing.md,
  },
  filterContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  countLabel: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  dealsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentLight,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 52,
  },
});
