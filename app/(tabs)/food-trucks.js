import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import FoodTruckCard from '../../src/components/FoodTruckCard';
import CategoryChip from '../../src/components/CategoryChip';
import CityHeaderControl from '../../src/components/CityHeaderControl';
import SearchBar from '../../src/components/SearchBar';
import FilterRow from '../../src/components/FilterRow';
import ToggleChip from '../../src/components/ToggleChip';
import PostButton from '../../src/components/PostButton';
import ListBody from '../../src/components/ListBody';
import { useListState } from '../../src/hooks/useListState';
import { useApp } from '../../src/context/AppContext';
import { CUISINES } from '../../src/data/foodTrucks';
import { daysFromNow } from '../../src/utils/dates';
import { buildTimeSections } from '../../src/utils/grouping';
import { colors } from '../../src/theme/theme';

export default function FoodTrucksScreen() {
  const router = useRouter();
  const { scale, foodTrucks, sponsors, loadingData, loadError, refresh, backendEnabled, signedIn } = useApp();
  const {
    query, setQuery, deferredQuery,
    activeFilter: activeCuisine, setActiveFilter: setActiveCuisine,
    toggle: todayOnly, setToggle: setTodayOnly,
    refreshing, onRefresh, isFiltering, clearFilters,
  } = useListState({ refresh });

  const goPost = (path) => {
    if (backendEnabled && !signedIn) router.push({ pathname: '/sign-in', params: { next: path } });
    else router.push(path);
  };

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return foodTrucks.filter((t) => {
      const matchesCuisine = activeCuisine === 'All' || t.cuisine === activeCuisine;
      const matchesToday = !todayOnly || daysFromNow(t.date) === 0;
      const matchesQuery =
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.cuisine.toLowerCase().includes(q) ||
        t.locationName.toLowerCase().includes(q);
      return matchesCuisine && matchesToday && matchesQuery;
    });
  }, [foodTrucks, deferredQuery, activeCuisine, todayOnly]);

  const sections = useMemo(
    () =>
      buildTimeSections({
        items: filtered,
        getDays: (t) => daysFromNow(t.date),
        isFeatured: (t) => t.featured,
        toRenderItem: (t) => ({ type: 'truck', truck: t, key: t.id }),
        injectAds: sponsors.length > 0,
      }),
    [filtered, sponsors.length]
  );

  return (
    <View style={styles.screen}>
      <CityHeaderControl
        bg={colors.foodTruck}
        label="FOOD TRUCKS IN"
        trailing={
          <PostButton
            label="Post Stop"
            onPress={() => goPost('/food-truck/new')}
            scale={scale}
            accessibilityLabel="Post a food truck stop"
          />
        }
      />

      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search trucks or food..."
        label="Search food trucks"
        scale={scale}
      />

      <FilterRow>
        <ToggleChip
          icon="today"
          label="Today"
          on={todayOnly}
          onPress={() => setTodayOnly((v) => !v)}
          accent={colors.foodTruck}
          tintLight={colors.foodTruckLight}
        />
        <CategoryChip label="All Food" selected={activeCuisine === 'All'} onPress={() => setActiveCuisine('All')} />
        {CUISINES.map((c) => (
          <CategoryChip key={c} label={c} selected={activeCuisine === c} onPress={() => setActiveCuisine(c)} />
        ))}
      </FilterRow>

      <ListBody
        sections={sections}
        renderCard={(item) => <FoodTruckCard truck={item.truck} />}
        accent={colors.foodTruck}
        sectionUnit="truck"
        refreshing={refreshing}
        onRefresh={onRefresh}
        loadError={loadError}
        loadingData={loadingData}
        countLabel={`${filtered.length} ${filtered.length === 1 ? 'truck' : 'trucks'} out`}
        isFiltering={isFiltering}
        onClearFilters={clearFilters}
        emptyFilter={{
          icon: 'fast-food-outline',
          title: 'No food trucks match that filter',
          body: 'Try a different cuisine or day, or clear your filters to see every truck.',
        }}
        emptyFirst={{
          icon: 'fast-food-outline',
          title: 'No food trucks posted',
          body: 'Run a food truck? Let people know where you’ll be!',
          actionLabel: 'Post Your Truck',
          onAction: () => goPost('/food-truck/new'),
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
