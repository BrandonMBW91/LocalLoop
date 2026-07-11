import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import GarageSaleCard from '../../src/components/GarageSaleCard';
import CategoryChip from '../../src/components/CategoryChip';
import CityHeaderControl from '../../src/components/CityHeaderControl';
import SearchBar from '../../src/components/SearchBar';
import FilterRow from '../../src/components/FilterRow';
import ToggleChip from '../../src/components/ToggleChip';
import PostButton from '../../src/components/PostButton';
import ListBody from '../../src/components/ListBody';
import { useListState } from '../../src/hooks/useListState';
import { useApp } from '../../src/context/AppContext';
import { SALE_ITEMS } from '../../src/data/garageSales';
import { daysFromNow } from '../../src/utils/dates';
import { buildTimeSections } from '../../src/utils/grouping';
import { colors } from '../../src/theme/theme';

export default function GarageSalesScreen() {
  const router = useRouter();
  const { scale, garageSales, sponsors, loadingData, loadError, refresh, backendEnabled, signedIn } = useApp();
  const {
    query, setQuery, deferredQuery,
    activeFilter: activeItem, setActiveFilter: setActiveItem,
    toggle: thisWeekOnly, setToggle: setThisWeekOnly,
    refreshing, onRefresh, isFiltering, clearFilters,
  } = useListState({ refresh });

  const goPost = (path) => {
    if (backendEnabled && !signedIn) router.push({ pathname: '/sign-in', params: { next: path } });
    else router.push(path);
  };

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return garageSales.filter((s) => {
      const matchesItem = activeItem === 'All' || (s.items || []).includes(activeItem);
      const matchesWeekend = !thisWeekOnly || daysFromNow(s.start) <= 7;
      const matchesQuery =
        !q ||
        s.title.toLowerCase().includes(q) ||
        s.address.toLowerCase().includes(q) ||
        (s.neighborhood || '').toLowerCase().includes(q) ||
        (s.items || []).join(' ').toLowerCase().includes(q);
      return matchesItem && matchesWeekend && matchesQuery;
    });
  }, [garageSales, deferredQuery, activeItem, thisWeekOnly]);

  // A multi-day sale running across today counts as "Today"; else group by start.
  const saleDays = (s) => {
    const ds = daysFromNow(s.start);
    const de = s.end ? daysFromNow(s.end) : ds;
    return ds <= 0 && de >= 0 ? 0 : ds;
  };

  const sections = useMemo(
    () =>
      buildTimeSections({
        items: filtered,
        getDays: saleDays,
        isFeatured: (s) => s.featured,
        toRenderItem: (s) => ({ type: 'sale', sale: s, key: s.id }),
        injectAds: sponsors.length > 0,
      }),
    [filtered, sponsors.length]
  );

  return (
    <View style={styles.screen}>
      <CityHeaderControl
        bg={colors.garageSale}
        label="GARAGE & YARD SALES IN"
        trailing={
          <PostButton
            label="Post Sale"
            onPress={() => goPost('/garage-sale/new')}
            scale={scale}
            accessibilityLabel="Post a garage sale"
          />
        }
      />

      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search by street or item..."
        label="Search garage sales"
        scale={scale}
      />

      <FilterRow>
        <ToggleChip
          icon="navigate"
          label="Plan a route"
          on={false}
          onPress={() => router.push('/route')}
          accent={colors.garageSale}
          tintLight={colors.garageSaleLight}
        />
        <ToggleChip
          icon="sunny"
          label="This Week"
          on={thisWeekOnly}
          onPress={() => setThisWeekOnly((v) => !v)}
          accent={colors.garageSale}
          tintLight={colors.garageSaleLight}
        />
        <CategoryChip label="All Items" selected={activeItem === 'All'} onPress={() => setActiveItem('All')} />
        {SALE_ITEMS.map((item) => (
          <CategoryChip key={item} label={item} selected={activeItem === item} onPress={() => setActiveItem(item)} />
        ))}
      </FilterRow>

      <ListBody
        sections={sections}
        renderCard={(item) => <GarageSaleCard sale={item.sale} />}
        accent={colors.garageSale}
        sectionUnit="sale"
        refreshing={refreshing}
        onRefresh={onRefresh}
        loadError={loadError}
        loadingData={loadingData}
        countLabel={`${filtered.length} ${filtered.length === 1 ? 'sale' : 'sales'} found`}
        isFiltering={isFiltering}
        onClearFilters={clearFilters}
        emptyFilter={{
          icon: 'pricetags-outline',
          title: 'No sales match that filter',
          body: 'Try a different item or week, or clear your filters to see every sale.',
        }}
        emptyFirst={{
          icon: 'pricetags-outline',
          title: 'No garage sales found',
          body: 'Having a sale this weekend? Be the first to post one!',
          actionLabel: 'Post a Garage Sale',
          onAction: () => goPost('/garage-sale/new'),
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
