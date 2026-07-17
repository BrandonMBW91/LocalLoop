import React, { useEffect, useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Pressable, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { fetchMetrics, fetchCityUsers, fetchPlatformSplit, fetchUsersByCity, fetchRevSplit } from '../src/lib/db';
import { CITIES } from '../src/data/cities';
import { BUILD, APP_VERSION } from '../src/version';
import { colors, spacing, radius } from '../src/theme/theme';

const CITY_NAME = Object.fromEntries(CITIES.map((c) => [c.id, c.name]));

const KIND_LABEL = { event: 'Events', garage_sale: 'Garage sales', food_truck: 'Food trucks' };
const KIND_COLOR = { event: colors.primary, garage_sale: colors.garageSale, food_truck: colors.foodTruck };
// Same hues, but dark enough for the white rank number to clear AA on them.
const KIND_FILL = { event: colors.primaryFill, garage_sale: colors.garageSaleFill, food_truck: colors.foodTruckFill };
const KIND_ROUTE = { event: 'event', garage_sale: 'garage-sale', food_truck: 'food-truck' };

function StatCard({ value, label, color, icon, onPress, expanded }) {
  const inner = (
    <>
      <View style={styles.statTop}>
        <Ionicons name={icon} size={18} color={color || colors.primary} />
        <ThemedText size="large" weight="bold" color={color || colors.text}>{value}</ThemedText>
      </View>
      <View style={styles.statLabelRow}>
        <ThemedText size="small" color={colors.textMuted}>{label}</ThemedText>
        {onPress ? (
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.textMuted}
          />
        ) : null}
      </View>
    </>
  );
  if (!onPress) return <View style={styles.statCard}>{inner}</View>;
  return (
    <Pressable
      style={[styles.statCard, expanded && { borderColor: color || colors.primary }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Tap to ${expanded ? 'hide' : 'see'} details.`}
    >
      {inner}
    </Pressable>
  );
}

export default function MetricsScreen() {
  const router = useRouter();
  const { isAdmin, city, cityId } = useApp();
  const [scope, setScope] = useState('all'); // 'all' towns (default) or the current city
  const [data, setData] = useState(null);
  const [users, setUsers] = useState(0);
  const [platform, setPlatform] = useState({ ios: 0, android: 0, web: 0, unknown: 0 });
  const [usersByCity, setUsersByCity] = useState([]); // [{cityId, users}] every town, desc
  const [revSplit, setRevSplit] = useState([]); // [{rev, runtime, embedded, users}]
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null); // 'featured' | 'ads' | null
  const toggle = (key) => setExpanded((cur) => (cur === key ? null : key));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const target = scope === 'all' ? null : cityId; // null => every town
      const [m, u, p, byCity, revs] = await Promise.all([
        fetchMetrics(target),
        fetchCityUsers(target),
        fetchPlatformSplit(target),
        // Always every town, regardless of scope: the point of the breakdown is to
        // compare towns, so scoping it to one town would make it a single row.
        fetchUsersByCity(),
        // Same: update adoption is a fleet-wide question, not a per-town one.
        fetchRevSplit(),
      ]);
      setData(m);
      setUsers(u);
      setPlatform(p);
      setUsersByCity(byCity);
      setRevSplit(revs);
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
        <StatCard
          icon="people"
          value={users}
          label="Active users (30d)"
          color={colors.success}
          onPress={usersByCity.length ? () => toggle('users') : undefined}
          expanded={expanded === 'users'}
        />
        <StatCard icon="eye" value={m.totalViews ?? 0} label="Total views" color={colors.primary} />
        <StatCard icon="list" value={m.totalListings ?? 0} label="Live listings" color={colors.text} />
        <StatCard
          icon="star"
          value={m.featuredCount ?? 0}
          label="Featured now"
          color={colors.accent}
          onPress={(m.featuredCount ?? 0) > 0 ? () => toggle('featured') : undefined}
          expanded={expanded === 'featured'}
        />
        <StatCard
          icon="megaphone"
          value={m.activeAds ?? 0}
          label="Active ads"
          color={colors.garageSale}
          onPress={(m.activeAds ?? 0) > 0 ? () => toggle('ads') : undefined}
          expanded={expanded === 'ads'}
        />
      </View>

      {/* Active users, per town. Always every town even when the scope chip is set to
          one city — the whole point is comparing towns against each other. */}
      {expanded === 'users' && usersByCity.length ? (
        <View style={[styles.card, { marginTop: spacing.sm }]}>
          {usersByCity.map((row, i) => {
            const town = CITIES.find((c) => c.id === row.cityId);
            const share = users > 0 ? Math.round((row.users / users) * 100) : 0;
            return (
              <Pressable
                key={`u-${row.cityId}`}
                style={[styles.detailRow, i > 0 && styles.rowBorder]}
                onPress={() => router.push({ pathname: '/city', params: { from: 'metrics' } })}
                accessibilityRole="button"
                accessibilityLabel={`${town?.name || row.cityId}, ${row.users} active users, ${share} percent of the total`}
              >
                <Ionicons name="people" size={16} color={colors.success} style={{ marginRight: spacing.sm }} />
                <ThemedText size="body" style={{ flex: 1 }} numberOfLines={1}>
                  {town?.name || row.cityId}
                </ThemedText>
                <ThemedText size="small" color={colors.textMuted} style={{ marginRight: spacing.sm }}>
                  {share}%
                </ThemedText>
                <ThemedText size="body" weight="bold" style={styles.userCount}>
                  {row.users}
                </ThemedText>
              </Pressable>
            );
          })}
          <ThemedText size="tiny" color={colors.textMuted} style={styles.byCityFoot}>
            {usersByCity.length} towns with activity in the last 30 days. Towns with none are not listed.
          </ThemedText>
        </View>
      ) : null}

      {/* Expanded detail for Featured / Active ads */}
      {expanded === 'featured' && (m.featuredItems?.length ?? 0) > 0 ? (
        <View style={[styles.card, { marginTop: spacing.sm }]}>
          {m.featuredItems.map((it, i) => (
            <Pressable
              key={`f-${it.kind}-${it.id}`}
              style={[styles.detailRow, i > 0 && styles.rowBorder]}
              onPress={() => router.push(`/${KIND_ROUTE[it.kind]}/${it.id}`)}
            >
              <Ionicons name="star" size={16} color={colors.accent} style={{ marginRight: spacing.sm }} />
              <ThemedText size="body" style={{ flex: 1 }} numberOfLines={1}>{it.title}</ThemedText>
              <ThemedText size="small" color={colors.textMuted} style={{ marginRight: 4 }}>
                {(KIND_LABEL[it.kind] || it.kind || '').replace(/s$/, '')}
              </ThemedText>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {expanded === 'ads' && (m.adItems?.length ?? 0) > 0 ? (
        <View style={[styles.card, { marginTop: spacing.sm }]}>
          {m.adItems.map((it, i) => (
            <Pressable
              key={`a-${it.id}`}
              style={[styles.detailRow, i > 0 && styles.rowBorder]}
              onPress={() => router.push(`/ads?city=${it.city_id}`)}
            >
              <Ionicons name="megaphone" size={16} color={colors.garageSale} style={{ marginRight: spacing.sm }} />
              <View style={{ flex: 1 }}>
                <ThemedText size="body" numberOfLines={1}>{it.title || 'Ad'}</ThemedText>
                <ThemedText size="small" color={colors.textMuted} numberOfLines={1}>
                  {CITY_NAME[it.city_id] || it.city_id}{it.link_url ? ` · ${it.link_url.replace(/^https?:\/\//, '')}` : ''}
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Are the auto-updates actually landing? Nothing could answer this before rev
          111: an OTA was published into silence. Three states matter and they look
          identical without the runtime:
            - on the current rev            -> the update landed
            - behind, current runtime       -> just has not reopened yet; self-heals
            - behind, OLD runtime           -> STRANDED. Can never receive a 1.0.4 OTA,
                                               no matter how long it waits. Needs a new
                                               binary from the store.
          Devices report nothing until they reopen on rev 111+, so "Not yet reported"
          shrinks on its own and is not a fault. */}
      {revSplit.length ? (
        <>
          <ThemedText size="subtitle" weight="bold" style={styles.sectionTitle}>
            Update adoption (30d)
          </ThemedText>
          <View style={styles.card}>
            {(() => {
              const sum = (rs) => rs.reduce((a, r) => a + r.users, 0);
              const total = sum(revSplit);
              const unknown = sum(revSplit.filter((r) => r.rev == null));
              const known = revSplit.filter((r) => r.rev != null);
              // A device on a runtime other than the current app version can never
              // receive an OTA for it. Nothing about waiting fixes that: it needs a
              // new binary from the store. Checked FIRST so it is never miscounted
              // as merely "behind".
              const stranded = known.filter((r) => r.runtime && r.runtime !== APP_VERSION);
              const reachable = known.filter((r) => !(r.runtime && r.runtime !== APP_VERSION));
              // Old BINARY but a runtime that still matches — can take OTAs, but is a
              // store version behind. app_version is native, so OTAs cannot fake it.
              const oldBinary = reachable.filter((r) => r.app_version && r.app_version !== APP_VERSION);
              const currentBinary = reachable.filter((r) => !(r.app_version && r.app_version !== APP_VERSION));
              // A stranded device cannot SAY it is stranded: the reporting code ships
              // in the very OTA it cannot receive, so `stranded` (runtime mismatch)
              // only ever catches ones that CAN report. update_blocked is the inference
              // that catches the rest: still no rev, yet opening long after the update
              // was available. Both are a FLOOR, never a count -- a stranded device
              // that never opens again is invisible to any method.
              const blocked = sum(revSplit.filter((r) => r.update_blocked));
              const notReported = unknown - blocked;
              const rows = [
                { key: 'cur', label: `On rev ${BUILD} (latest)`, icon: 'checkmark-circle', color: colors.success, n: sum(currentBinary.filter((r) => r.rev === BUILD)) },
                { key: 'behind', label: 'Behind, updates on next open', icon: 'time-outline', color: colors.textMuted, n: sum(currentBinary.filter((r) => r.rev !== BUILD)) },
                { key: 'oldapp', label: `On an older app version (not ${APP_VERSION})`, icon: 'download-outline', color: colors.garageSale, n: sum(oldBinary) },
                { key: 'stranded', label: 'STRANDED: old runtime, no OTA can reach', icon: 'warning', color: colors.accent, n: sum(stranded) },
                { key: 'blocked', label: 'Opening, but not taking updates (likely stranded)', icon: 'warning-outline', color: colors.accent, n: blocked },
                { key: 'unknown', label: 'Not yet reported (no open since tracking shipped)', icon: 'help-circle-outline', color: colors.textMuted, n: notReported },
              ].filter((r) => r.n > 0);
              return rows.map((p, i) => {
                const pct = total ? Math.round((p.n / total) * 100) : 0;
                return (
                  <View key={p.key} style={[styles.breakRow, i > 0 && styles.rowBorder]}>
                    <Ionicons name={p.icon} size={20} color={p.color} style={{ marginRight: spacing.sm }} />
                    <ThemedText size="body" style={{ flex: 1 }}>{p.label}</ThemedText>
                    <ThemedText size="small" color={colors.textMuted} style={{ marginRight: spacing.md }}>{pct}%</ThemedText>
                    <ThemedText size="body" weight="bold" color={p.key === 'stranded' ? colors.accent : colors.text}>{p.n}</ThemedText>
                  </View>
                );
              });
            })()}
          </View>
        </>
      ) : null}

      {/* Active users by platform */}
      <ThemedText size="subtitle" weight="bold" style={styles.sectionTitle}>
        Users by platform (30d)
      </ThemedText>
      <View style={styles.card}>
        {(() => {
          const total = platform.ios + platform.android + platform.web + platform.unknown;
          const rows = [
            { key: 'ios', label: 'iPhone / iPad', icon: 'logo-apple', color: colors.text },
            { key: 'android', label: 'Android', icon: 'logo-android', color: colors.success },
            { key: 'web', label: 'Web (localloop.io)', icon: 'globe-outline', color: colors.primary },
          ];
          if (platform.unknown) rows.push({ key: 'unknown', label: 'Not yet identified', icon: 'help-circle-outline', color: colors.textMuted });
          return rows.map((p, i) => {
            const pct = total ? Math.round((platform[p.key] / total) * 100) : 0;
            return (
              <View key={p.key} style={[styles.breakRow, i > 0 && styles.rowBorder]}>
                <Ionicons name={p.icon} size={20} color={p.color} style={{ marginRight: spacing.sm }} />
                <ThemedText size="body" style={{ flex: 1 }}>{p.label}</ThemedText>
                <ThemedText size="small" color={colors.textMuted} style={{ marginRight: spacing.md }}>{pct}%</ThemedText>
                <ThemedText size="body" weight="bold">{platform[p.key]}</ThemedText>
              </View>
            );
          });
        })()}
      </View>
      {platform.unknown ? (
        <ThemedText size="small" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
          Platform is recorded as each device opens the app, so "Not yet identified" shrinks over the next day or two.
        </ThemedText>
      ) : null}

      {/* Views by type */}
      <ThemedText size="subtitle" weight="bold" style={styles.sectionTitle}>
        Views by type
      </ThemedText>
      <View style={styles.card}>
        {['event', 'garage_sale', 'food_truck'].map((k, i) => {
          // Garage sales + food trucks expand into the actual listings (they
          // stay countable-by-hand for a long time); events would be thousands.
          const items = m.listItems?.[k];
          const canExpand = Boolean(items?.length);
          const row = (
            <>
              <View style={[styles.dot, { backgroundColor: KIND_COLOR[k] }]} />
              <ThemedText size="body" style={{ flex: 1 }}>{KIND_LABEL[k]}</ThemedText>
              <ThemedText size="small" color={colors.textMuted} style={{ marginRight: spacing.md }}>
                {m.counts?.[k] ?? 0} live
              </ThemedText>
              <ThemedText size="body" weight="bold">{m.views?.[k] ?? 0}</ThemedText>
              <Ionicons name="eye-outline" size={16} color={colors.textMuted} style={{ marginLeft: 4 }} />
              {canExpand ? (
                <Ionicons
                  name={expanded === `kind-${k}` ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textMuted}
                  style={{ marginLeft: spacing.sm }}
                />
              ) : null}
            </>
          );
          if (!canExpand) {
            return <View key={k} style={[styles.breakRow, i > 0 && styles.rowBorder]}>{row}</View>;
          }
          return (
            <React.Fragment key={k}>
              <Pressable
                style={[styles.breakRow, i > 0 && styles.rowBorder]}
                onPress={() => toggle(`kind-${k}`)}
                accessibilityRole="button"
                accessibilityLabel={`${KIND_LABEL[k]}: ${m.counts?.[k] ?? 0} live. Tap to ${expanded === `kind-${k}` ? 'hide' : 'see'} them.`}
              >
                {row}
              </Pressable>
              {expanded === `kind-${k}`
                ? items.map((it) => (
                    <Pressable
                      key={`${k}-${it.id}`}
                      style={[styles.detailRow, styles.rowBorder, { paddingLeft: spacing.lg }]}
                      onPress={() => router.push(`/${KIND_ROUTE[k]}/${it.id}`)}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <ThemedText size="body" numberOfLines={1}>{it.title}</ThemedText>
                        <ThemedText size="small" color={colors.textMuted} numberOfLines={1}>
                          {CITY_NAME[it.city_id] || it.city_id}
                          {it.when ? ` · ${it.when}` : ''}
                          {it.ended ? ' · ended' : ''}
                        </ThemedText>
                      </View>
                      <View style={[styles.srcBadge, it.source === 'user' ? styles.srcUser : it.source === 'feed' ? styles.srcFeed : styles.srcAnon]}>
                        <ThemedText size="small" weight="bold" color={colors.textInverse}>
                          {it.source === 'user' ? 'User post' : it.source === 'feed' ? 'Auto feed' : 'No account'}
                        </ThemedText>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 4 }} />
                    </Pressable>
                  ))
                : null}
            </React.Fragment>
          );
        })}
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
              <View style={[styles.rank, { backgroundColor: KIND_FILL[t.kind] }]}>
                <ThemedText size="small" weight="bold" color={colors.textInverse}>{i + 1}</ThemedText>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <ThemedText size="body" weight="semibold" numberOfLines={1}>{t.title}</ThemedText>
                {CITY_NAME[t.cityId] ? (
                  <ThemedText size="small" color={colors.textMuted} numberOfLines={1}>{CITY_NAME[t.cityId]}</ThemedText>
                ) : null}
              </View>
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
  // tabular-nums so the counts line up in a column instead of jittering by digit width
  userCount: { minWidth: 34, textAlign: 'right', fontVariant: ['tabular-nums'] },
  byCityFoot: { padding: spacing.sm, paddingTop: spacing.xs },
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
  togglePillActive: { backgroundColor: colors.primaryFill, borderColor: colors.primary },
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
  statLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.md },
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
  srcBadge: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, marginLeft: spacing.sm },
  srcUser: { backgroundColor: colors.success },
  srcFeed: { backgroundColor: colors.primaryFill },
  srcAnon: { backgroundColor: colors.textMuted },
  rank: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
  },
});
