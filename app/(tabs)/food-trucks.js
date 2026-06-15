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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ThemedText from '../../src/components/ThemedText';
import FoodTruckCard from '../../src/components/FoodTruckCard';
import CategoryChip from '../../src/components/CategoryChip';
import AdBanner from '../../src/components/AdBanner';
import SectionHeader from '../../src/components/SectionHeader';
import SkeletonList from '../../src/components/SkeletonCard';
import EmptyState from '../../src/components/EmptyState';
import { useApp } from '../../src/context/AppContext';
import { CUISINES } from '../../src/data/foodTrucks';
import { daysFromNow } from '../../src/utils/dates';
import { buildTimeSections } from '../../src/utils/grouping';
import { colors, spacing, radius, baseFont } from '../../src/theme/theme';

export default function FoodTrucksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { city, scale, foodTrucks, sponsors, loadingData, refresh, backendEnabled, signedIn } = useApp();

  // Require sign-in before reaching a post form when a backend is configured.
  const goPost = (path) => {
    if (backendEnabled && !signedIn) {
      router.push({ pathname: '/sign-in', params: { next: path } });
    } else {
      router.push(path);
    }
  };
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [activeCuisine, setActiveCuisine] = useState('All');
  const [todayOnly, setTodayOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
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
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={{ flex: 1 }}>
          <ThemedText size="tiny" color={colors.textInverse} style={{ opacity: 0.85 }}>
            FOOD TRUCKS IN
          </ThemedText>
          <ThemedText size="large" weight="bold" color={colors.textInverse}>
            {city.name}, {city.state}
          </ThemedText>
        </View>
        <Pressable
          onPress={() => goPost('/food-truck/new')}
          style={styles.postBtn}
          accessibilityRole="button"
          accessibilityLabel="Post a food truck stop"
        >
          <Ionicons name="add" size={22 * Math.min(scale, 1.2)} color={colors.textInverse} />
          <ThemedText size="small" weight="bold" color={colors.textInverse}>
            Post Stop
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={22} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search trucks or food..."
          placeholderTextColor={colors.textMuted}
          style={[styles.searchInput, { fontSize: Math.round(baseFont.body * scale) }]}
          accessibilityLabel="Search food trucks"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={22} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      <View style={styles.filterRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterContent}
        >
          <Pressable
            onPress={() => setTodayOnly((v) => !v)}
            style={[styles.todayChip, todayOnly && styles.todayChipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: todayOnly }}
          >
            <Ionicons
              name="today"
              size={18}
              color={todayOnly ? colors.textInverse : colors.foodTruck}
            />
            <ThemedText
              size="small"
              weight="bold"
              color={todayOnly ? colors.textInverse : colors.foodTruck}
            >
              Today
            </ThemedText>
          </Pressable>
          <CategoryChip
            label="All Food"
            selected={activeCuisine === 'All'}
            onPress={() => setActiveCuisine('All')}
          />
          {CUISINES.map((c) => (
            <CategoryChip
              key={c}
              label={c}
              selected={activeCuisine === c}
              onPress={() => setActiveCuisine(c)}
            />
          ))}
        </ScrollView>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) =>
          item.type === 'ad' ? <AdBanner index={item.adIndex} /> : <FoodTruckCard truck={item.truck} />
        }
        renderSectionHeader={({ section }) => (
          <SectionHeader title={section.title} count={section.count} accent={colors.foodTruck} unit="truck" />
        )}
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.foodTruck]}
            tintColor={colors.foodTruck}
          />
        }
        ListHeaderComponent={
          loadingData ? null : (
            <ThemedText size="small" color={colors.textMuted} style={styles.countLabel}>
              {filtered.length} {filtered.length === 1 ? 'truck' : 'trucks'} out
            </ThemedText>
          )
        }
        ListEmptyComponent={
          loadingData ? (
            <SkeletonList />
          ) : (
            <EmptyState
              icon="fast-food-outline"
              title="No food trucks posted"
              body="Run a food truck? Let people know where you’ll be!"
              actionLabel="Post Your Truck"
              onAction={() => goPost('/food-truck/new')}
              accent={colors.foodTruck}
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    backgroundColor: colors.foodTruck,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  postBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    minHeight: 44,
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
  searchInput: { flex: 1, color: colors.text, paddingVertical: 12 },
  filterRow: { marginTop: spacing.md },
  filterContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  todayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.foodTruckLight,
    borderWidth: 1.5,
    borderColor: colors.foodTruck,
    marginRight: spacing.sm,
    minHeight: 44,
  },
  todayChipOn: { backgroundColor: colors.foodTruck },
  countLabel: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  empty: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.foodTruck,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
});
