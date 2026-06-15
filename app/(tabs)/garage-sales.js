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
import GarageSaleCard from '../../src/components/GarageSaleCard';
import CategoryChip from '../../src/components/CategoryChip';
import AdBanner from '../../src/components/AdBanner';
import SectionHeader from '../../src/components/SectionHeader';
import SkeletonList from '../../src/components/SkeletonCard';
import EmptyState from '../../src/components/EmptyState';
import { useApp } from '../../src/context/AppContext';
import { SALE_ITEMS } from '../../src/data/garageSales';
import { daysFromNow } from '../../src/utils/dates';
import { buildTimeSections } from '../../src/utils/grouping';
import { colors, spacing, radius, baseFont } from '../../src/theme/theme';

export default function GarageSalesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { city, scale, garageSales, loadingData, refresh, backendEnabled, signedIn } = useApp();

  const goPost = (path) => {
    if (backendEnabled && !signedIn) {
      router.push({ pathname: '/sign-in', params: { next: path } });
    } else {
      router.push(path);
    }
  };
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [activeItem, setActiveItem] = useState('All');
  const [weekendOnly, setWeekendOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const sales = garageSales;

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return sales.filter((s) => {
      const matchesItem = activeItem === 'All' || (s.items || []).includes(activeItem);
      const matchesWeekend = !weekendOnly || daysFromNow(s.start) <= 7;
      const matchesQuery =
        !q ||
        s.title.toLowerCase().includes(q) ||
        s.address.toLowerCase().includes(q) ||
        (s.neighborhood || '').toLowerCase().includes(q) ||
        (s.items || []).join(' ').toLowerCase().includes(q);
      return matchesItem && matchesWeekend && matchesQuery;
    });
  }, [sales, deferredQuery, activeItem, weekendOnly]);

  // A multi-day sale that's running across today counts as "Today"; otherwise
  // group by its start date.
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
      }),
    [filtered]
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={{ flex: 1 }}>
          <ThemedText size="tiny" color={colors.textInverse} style={{ opacity: 0.85 }}>
            GARAGE & YARD SALES IN
          </ThemedText>
          <ThemedText size="large" weight="bold" color={colors.textInverse}>
            {city.name}, {city.state}
          </ThemedText>
        </View>
        <Pressable
          onPress={() => goPost('/garage-sale/new')}
          style={styles.postBtn}
          accessibilityRole="button"
          accessibilityLabel="Post a garage sale"
        >
          <Ionicons name="add" size={22 * Math.min(scale, 1.2)} color={colors.textInverse} />
          <ThemedText size="small" weight="bold" color={colors.textInverse}>
            Post Sale
          </ThemedText>
        </Pressable>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={22} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by street or item..."
          placeholderTextColor={colors.textMuted}
          style={[styles.searchInput, { fontSize: Math.round(baseFont.body * scale) }]}
          accessibilityLabel="Search garage sales"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={22} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {/* Weekend toggle + item filters */}
      <View style={styles.filterRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterContent}
        >
          <Pressable
            onPress={() => setWeekendOnly((v) => !v)}
            style={[styles.weekendChip, weekendOnly && styles.weekendChipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: weekendOnly }}
          >
            <Ionicons
              name="sunny"
              size={18}
              color={weekendOnly ? colors.textInverse : colors.garageSale}
            />
            <ThemedText
              size="small"
              weight="bold"
              color={weekendOnly ? colors.textInverse : colors.garageSale}
            >
              This Week
            </ThemedText>
          </Pressable>
          <CategoryChip
            label="All Items"
            selected={activeItem === 'All'}
            onPress={() => setActiveItem('All')}
          />
          {SALE_ITEMS.map((item) => (
            <CategoryChip
              key={item}
              label={item}
              selected={activeItem === item}
              onPress={() => setActiveItem(item)}
            />
          ))}
        </ScrollView>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) =>
          item.type === 'ad' ? <AdBanner index={item.adIndex} /> : <GarageSaleCard sale={item.sale} />
        }
        renderSectionHeader={({ section }) => (
          <SectionHeader title={section.title} count={section.count} accent={colors.garageSale} unit="sale" />
        )}
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.garageSale]}
            tintColor={colors.garageSale}
          />
        }
        ListHeaderComponent={
          loadingData ? null : (
            <ThemedText size="small" color={colors.textMuted} style={styles.countLabel}>
              {filtered.length} {filtered.length === 1 ? 'sale' : 'sales'} found
            </ThemedText>
          )
        }
        ListEmptyComponent={
          loadingData ? (
            <SkeletonList />
          ) : (
            <EmptyState
              icon="pricetags-outline"
              title="No garage sales found"
              body="Having a sale this weekend? Be the first to post one!"
              actionLabel="Post a Garage Sale"
              onAction={() => goPost('/garage-sale/new')}
              accent={colors.garageSale}
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
    backgroundColor: colors.garageSale,
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
  searchInput: {
    flex: 1,
    color: colors.text,
    paddingVertical: 12,
  },
  filterRow: { marginTop: spacing.md },
  filterContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  weekendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.garageSaleLight,
    borderWidth: 1.5,
    borderColor: colors.garageSale,
    marginRight: spacing.sm,
    minHeight: 44,
  },
  weekendChipOn: {
    backgroundColor: colors.garageSale,
  },
  countLabel: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
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
    backgroundColor: colors.garageSale,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
});
