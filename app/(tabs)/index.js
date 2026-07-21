import React, { useMemo, useEffect, useRef } from 'react';
import { View, StyleSheet, Pressable, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ThemedText from '../../src/components/ThemedText';
import EventCard from '../../src/components/EventCard';
import CategoryChip from '../../src/components/CategoryChip';
import EditorPickBanner from '../../src/components/EditorPickBanner';
import WebInstallBanner from '../../src/components/WebInstallBanner';
import CityHeaderControl from '../../src/components/CityHeaderControl';
import SearchBar from '../../src/components/SearchBar';
import FilterRow from '../../src/components/FilterRow';
import ToggleChip from '../../src/components/ToggleChip';
import { isKidsEvent } from '../../src/utils/kids';
import ListBody from '../../src/components/ListBody';
import { useListState } from '../../src/hooks/useListState';
import { useApp } from '../../src/context/AppContext';
import { CATEGORIES } from '../../src/data/events';
import { daysFromNow, touchesToday, touchesWeekend } from '../../src/utils/dates';
import { buildTimeSections } from '../../src/utils/grouping';
import { shareAppMessage } from '../../src/lib/links';
import { venueCore } from '../../src/utils/place';
import { useTownRate } from '../../src/hooks/useTownRate';
import { colors, spacing, radius } from '../../src/theme/theme';

export default function EventsScreen() {
  const router = useRouter();
  const {
    city, cityId, scale, events, deals, sponsors, editorPick, interests, follows,
    loadingData, loadError, refresh, backendEnabled, signedIn, logEvent,
    hideKids, setHideKids,
  } = useApp();
  // The house ad quotes a price, so it must be THIS town's price. Fetching only when
  // the ad can actually render keeps it off the critical path for the 134 towns that
  // already have a sponsor booked.
  const { known: rateKnown, sponsor: townPrice } = useTownRate(
    cityId,
    backendEnabled && !loadingData && sponsors.length === 0,
  );
  const {
    query, setQuery, deferredQuery,
    activeFilter: activeCat, setActiveFilter: setActiveCat,
    refreshing, onRefresh, isFiltering, clearFilters,
  } = useListState({ refresh });

  // Once interests hydrate from storage, default the feed to "For You" so the
  // personalization 71% of users set up isn't thrown away on the one screen
  // everyone sees. Only auto-applies while the filter is untouched (still 'All'),
  // so it never overrides a manual choice.
  const autoForYou = useRef(false);
  useEffect(() => {
    if (!autoForYou.current && interests.length > 0 && activeCat === 'All') {
      autoForYou.current = true;
      setActiveCat('For You');
    }
  }, [interests, activeCat, setActiveCat]);

  const goPost = (path) => {
    if (backendEnabled && !signedIn) router.push({ pathname: '/sign-in', params: { next: path } });
    else router.push(path);
  };

  const onInvite = () => Share.share({ message: shareAppMessage() }).catch(() => {});

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return events.filter((e) => {
      if (hideKids && isKidsEvent(e)) return false;
      const matchesFilter =
        activeCat === 'All' ? true
        : activeCat === 'Today' ? touchesToday(e.start, e.end)
        : activeCat === 'Weekend' ? touchesWeekend(e.start, e.end)
        : activeCat === 'Free' ? /free/i.test(e.price || '')
        : activeCat === 'For You' ? (interests.length === 0 || interests.includes(e.category))
        : activeCat === 'Following' ? follows.some((f) => venueCore(f) === venueCore(e.venue))
        : e.category === activeCat;
      const matchesQuery =
        !q ||
        e.title.toLowerCase().includes(q) ||
        e.venue.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [events, deferredQuery, activeCat, interests, follows, hideKids]);

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
        {/* A persistent on/off toggle (not a single-select category), so it uses
            ToggleChip and combines with whatever category is active. */}
        <ToggleChip
          icon="happy-outline"
          label="Hide kids"
          on={hideKids}
          onPress={() => setHideKids(!hideKids)}
          accent={colors.primary}
          tintLight={colors.primaryLight}
        />
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
            <WebInstallBanner />
            <EditorPickBanner pick={editorPick} />
            {!loadingData && deals.length > 0 ? (
              <Pressable style={styles.dealsBanner} onPress={() => router.push('/deals')}>
                <Ionicons name="pricetags" size={20} color={colors.accent} />
                <ThemedText size="body" weight="bold" color={colors.accent} style={{ flex: 1 }}>
                  {deals.length} local {deals.length === 1 ? 'deal' : 'deals'} in {city.name}
                </ThemedText>
                <Ionicons name="chevron-forward" size={20} color={colors.accent} />
              </Pressable>
            ) : null}
            {!loadingData && sponsors.length === 0 ? (
              <Pressable
                style={styles.houseAd}
                onPress={() => router.push('/promote')}
                accessibilityRole="link"
                accessibilityLabel={`Advertise your ${city.name} business on Local Loop`}
              >
                <Ionicons name="megaphone-outline" size={20} color={colors.primary} />
                <ThemedText size="small" weight="bold" color={colors.primary} style={{ flex: 1 }}>
                  {/* "from" is deliberately gone: it reads as a floor and it was not
                      one. And no number at all beats a wrong one — the tap lands on a
                      page that will quote the real rate either way. */}
                  {rateKnown
                    ? `Reach ${city.name}. Put your business here for $${townPrice}/mo.`
                    : `Reach ${city.name}. Put your business here.`}
                </ThemedText>
                <Ionicons name="chevron-forward" size={20} color={colors.primary} />
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
          icon: 'calendar-outline',
          title: `${city.name}'s calendar is just getting started`,
          body: 'Events come from locals like you. Add one, or invite a neighbor to help fill it in.',
          actionLabel: 'Submit an Event',
          onAction: () => goPost('/event/new'),
          secondaryLabel: 'Invite a neighbor',
          onSecondary: onInvite,
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
  houseAd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 52,
  },
});
