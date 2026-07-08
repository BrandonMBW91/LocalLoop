import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ThemedText from '../../src/components/ThemedText';
import EventCard from '../../src/components/EventCard';
import CategoryChip from '../../src/components/CategoryChip';
import EditorPickBanner from '../../src/components/EditorPickBanner';
import CityHeaderControl from '../../src/components/CityHeaderControl';
import SearchBar from '../../src/components/SearchBar';
import FilterRow from '../../src/components/FilterRow';
import ListBody from '../../src/components/ListBody';
import { useListState } from '../../src/hooks/useListState';
import { useApp } from '../../src/context/AppContext';
import { CATEGORIES } from '../../src/data/events';
import { daysFromNow, isThisWeekend } from '../../src/utils/dates';
import { buildTimeSections } from '../../src/utils/grouping';
import { colors, spacing, radius } from '../../src/theme/theme';

export default function EventsScreen() {
  const router = useRouter();
  const {
    city, scale, events, deals, sponsors, editorPick, interests, follows,
    loadingData, loadError, refresh, backendEnabled, signedIn, logEvent,
  } = useApp();
  const {
    query, setQuery, deferredQuery,
    activeFilter: activeCat, setActiveFilter: setActiveCat,
    refreshing, onRefresh, isFiltering, clearFilters,
  } = useListState({ refresh });

  const goPost = (path) => {
    if (backendEnabled && !signedIn) router.push({ pathname: '/sign-in', params: { next: path } });
    else router.push(path);
  };

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return events.filter((e) => {
      const matchesFilter =
        activeCat === 'All' ? true
        : activeCat === 'Today' ? daysFromNow(e.start) === 0
        : activeCat === 'Weekend' ? isThisWeekend(e.start)
        : activeCat === 'Free' ? /free/i.test(e.price || '')
        : activeCat === 'For You' ? (interests.length === 0 || interests.includes(e.category))
        : activeCat === 'Following' ? follows.includes(e.venue)
        : e.category === activeCat;
      const matchesQuery =
        !q ||
        e.title.toLowerCase().includes(q) ||
        e.venue.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [events, deferredQuery, activeCat, interests, follows]);

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
      <CityHeaderControl label="SHOWING EVENTS IN" showTagline showViews />

      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search events..."
        label="Search events"
        scale={scale}
        onSubmit={(term) => logEvent('search', { term: term.slice(0, 40) })}
      />

      <FilterRow>
        <CategoryChip label="All" selected={activeCat === 'All'} onPress={() => setActiveCat('All')} />
        {interests.length > 0 ? (
          <CategoryChip label="For You" selected={activeCat === 'For You'} onPress={() => setActiveCat('For You')} />
        ) : null}
        <CategoryChip label="Today" selected={activeCat === 'Today'} onPress={() => setActiveCat('Today')} />
        <CategoryChip label="Weekend" selected={activeCat === 'Weekend'} onPress={() => setActiveCat('Weekend')} />
        <CategoryChip label="Free" selected={activeCat === 'Free'} onPress={() => setActiveCat('Free')} />
        {follows.length > 0 ? (
          <CategoryChip label="Following" selected={activeCat === 'Following'} onPress={() => setActiveCat('Following')} />
        ) : null}
        {CATEGORIES.map((cat) => (
          <CategoryChip key={cat} label={cat} selected={activeCat === cat} onPress={() => setActiveCat(cat)} />
        ))}
      </FilterRow>

      <ListBody
        sections={sections}
        renderCard={(item) => <EventCard event={item.event} />}
        accent={colors.primary}
        sectionUnit="event"
        refreshing={refreshing}
        onRefresh={onRefresh}
        loadError={loadError}
        loadingData={loadingData}
        countLabel={`${filtered.length} ${filtered.length === 1 ? 'event' : 'events'} found`}
        headerExtras={
          <>
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
          </>
        }
        isFiltering={isFiltering}
        onClearFilters={clearFilters}
        emptyFilter={{
          icon: 'search',
          title: 'No events match that filter',
          body: 'Try a different category or search, or clear your filters to see everything.',
        }}
        emptyFirst={{
          icon: 'search',
          title: 'No events found',
          body: 'Nothing is posted here yet. Be the first to add one!',
          actionLabel: 'Submit an Event',
          onAction: () => goPost('/event/new'),
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
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
