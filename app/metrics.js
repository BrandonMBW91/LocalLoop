import React, { useEffect, useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Pressable, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { fetchMetrics, fetchCityUsers } from '../src/lib/db';
import { colors, spacing, radius } from '../src/theme/theme';

const KIND_LABEL = { event: 'Events', garage_sale: 'Garage sales', food_truck: 'Food trucks' };
const KIND_COLOR = { event: colors.primary, garage_sale: colors.garageSale, food_truck: colors.foodTruck };
const KIND_ROUTE = { event: 'event', garage_sale: 'garage-sale', food_truck: 'food-truck' };

function StatCard({ value, label, color, icon }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statTop}>
        <Ionicons name={icon} size={18} color={color || colors.primary} />
        <ThemedText size="large" weight="bold" color={color || colors.text}>{value}</ThemedText>
      </View>
      <ThemedText size="small" color={colors.textMuted}>{label}</ThemedText>
    </View>
  );
}

export default function MetricsScreen() {
  const router = useRouter();
  const { isAdmin, city, cityId } = useApp();
  const [scope, setScope] = useState('all'); // 'all' towns (default) or the current city
  const [data, setData] = useState(null);
  const [users, setUsers] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const target = scope === 'all' ? null : cityId; // null => every town
      const [m, u] = await Promise.all([fetchMetrics(target), fetchCityUsers(target)]);
      setData(m);
      setUsers(u);
    } catch (e) {
      Alert.alert('Could not load', e?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, [scope, cityId]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed" size={40} color={colors.textMuted} />
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
          This area is for moderators. Sign in with your admin account to see metrics.
        </ThemedText>
      </View>
    );
  }

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const m = data || { counts: {}, views: {}, top: [] };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
    >
      <ThemedText size="small" color={colors.textMuted}>SHOWING REACH FOR</ThemedText>
      <ThemedText size="large" weight="bold" style={{ marginBottom: spacing.sm }}>
        {scope === 'all' ? 'All towns' : `${city.name}, ${city.state}`}
      </ThemedText>
      <View style={styles.toggle}>
        <Pressable
          style={[styles.togglePill, scope === 'all' && styles.togglePillActive]}
          onPress={() => setScope('all')}
        >
          <ThemedText size="small" weight="bold" color={scope === 'all' ? colors.textInverse : colors.textMuted}>
            All towns
          </ThemedText>
        </Pressable>
        <Pressable
          style={[styles.togglePill, scope === 'city' && styles.togglePillActive]}
          onPress={() => setScope('city')}
        >
          <ThemedText size="small" weight="bold" color={scope === 'city' ? colors.textInverse : colors.textMuted}>
            {city.name}
          </ThemedText>
        </Pressable>
      </View>
      <ThemedText size="small" color={colors.textMuted} style={{ marginBottom: spacing.md }}>
        {scope === 'all'
          ? 'Combined across every town. Pull down to refresh.'
          : 'This town only. Pull down to refresh.'}
      </ThemedText>

      {/* Headline numbers */}
      <View style={styles.grid}>
        <StatCard icon="people" value={users} label="Active users (30d)" color={colors.success} />
        <StatCard icon="eye" value={m.totalViews ?? 0} label="Total views" color={colors.primary} />
        <StatCard icon="list" value={m.totalListings ?? 0} label="Live listings" color={colors.text} />
        <StatCard icon="star" value={m.featuredCount ?? 0} label="Featured now" color={colors.accent} />
        <StatCard icon="megaphone" value={m.activeAds ?? 0} label="Active ads" color={colors.garageSale} />
      </View>

      {/* Views by type */}
      <ThemedText size="subtitle" weight="bold" style={styles.sectionTitle}>
        Views by type
      </ThemedText>
      <View style={styles.card}>
        {['event', 'garage_sale', 'food_truck'].map((k, i) => (
          <View key={k} style={[styles.breakRow, i > 0 && styles.rowBorder]}>
            <View style={[styles.dot, { backgroundColor: KIND_COLOR[k] }]} />
            <ThemedText size="body" style={{ flex: 1 }}>{KIND_LABEL[k]}</ThemedText>
            <ThemedText size="small" color={colors.textMuted} style={{ marginRight: spacing.md }}>
              {m.counts?.[k] ?? 0} live
            </ThemedText>
            <ThemedText size="body" weight="bold">{m.views?.[k] ?? 0}</ThemedText>
            <Ionicons name="eye-outline" size={16} color={colors.textMuted} style={{ marginLeft: 4 }} />
          </View>
        ))}
      </View>

      {/* Top listings */}
      <ThemedText size="subtitle" weight="bold" style={styles.sectionTitle}>
        Most viewed
      </ThemedText>
      {m.top?.length ? (
        <View style={styles.card}>
          {m.top.map((t, i) => (
            <Pressable
              key={`${t.kind}-${t.id}`}
              style={[styles.topRow, i > 0 && styles.rowBorder]}
              onPress={() => router.push(`/${KIND_ROUTE[t.kind]}/${t.id}`)}
            >
              <View style={[styles.rank, { backgroundColor: KIND_COLOR[t.kind] }]}>
                <ThemedText size="small" weight="bold" color={colors.textInverse}>{i + 1}</ThemedText>
              </View>
              <ThemedText size="body" weight="semibold" style={{ flex: 1 }} numberOfLines={1}>
                {t.title}
              </ThemedText>
              <ThemedText size="body" weight="bold" color={colors.primary}>{t.views}</ThemedText>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
      ) : (
        <ThemedText size="body" color={colors.textMuted} style={{ paddingVertical: spacing.md }}>
          No views recorded yet. As people open listings, their counts show up here.
        </ThemedText>
      )}

      <ThemedText size="small" color={colors.textMuted} style={{ marginTop: spacing.lg, textAlign: 'center' }}>
        Views are counted each time someone opens a listing. Use these numbers to
        show local businesses the reach they’d get.
      </ThemedText>
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
  toggle: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  togglePill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  togglePillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statCard: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 2,
  },
  statTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  breakRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.sm },
  rank: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
  },
});
