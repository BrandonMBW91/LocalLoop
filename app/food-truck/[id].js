import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Linking, Platform, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ThemedText from '../../src/components/ThemedText';
import AdBanner from '../../src/components/AdBanner';
import DetailSkeleton from '../../src/components/DetailSkeleton';
import ReportButton from '../../src/components/ReportButton';
import FeatureButton from '../../src/components/FeatureButton';
import { useApp } from '../../src/context/AppContext';
import { recordView, fetchOneById } from '../../src/lib/db';
import { CUISINE_EMOJI } from '../../src/data/foodTrucks';
import { colors, spacing, radius } from '../../src/theme/theme';
import { formatLongDate } from '../../src/utils/dates';
import { shareUrl, shareFooter } from '../../src/lib/links';

function InfoRow({ icon, label, value, onPress }) {
  const Wrap = onPress ? Pressable : View;
  return (
    <Wrap style={styles.infoRow} onPress={onPress}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={22} color={colors.foodTruck} />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText size="small" color={colors.textMuted}>{label}</ThemedText>
        <ThemedText size="body" weight="semibold" color={onPress ? colors.foodTruck : colors.text}>
          {value}
        </ThemedText>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={20} color={colors.textMuted} /> : null}
    </Wrap>
  );
}

export default function FoodTruckDetailScreen() {
  const { id: rawId } = useLocalSearchParams();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const router = useRouter();
  const { findFoodTruckById, backendEnabled, isAdmin, toggleFollow, isFollowing } = useApp();
  const cached = findFoodTruckById(id);
  const [fetched, setFetched] = useState(null);
  const [fetching, setFetching] = useState(!cached && backendEnabled && !!id);
  useEffect(() => {
    if (!cached && backendEnabled && id) {
      let ok = true;
      setFetching(true);
      fetchOneById('food_truck', id)
        .then((t) => { if (ok) { setFetched(t); setFetching(false); } })
        .catch(() => { if (ok) setFetching(false); });
      return () => { ok = false; };
    }
    setFetching(false);
  }, [cached, backendEnabled, id]);
  const truck = cached || fetched;

  // Record the view once per id, but only AFTER the truck has resolved, so a deep
  // link to a deleted/invalid truck (which renders "not found") and remounts don't
  // inflate the view counts shown to advertisers. Owner/admin views are excluded.
  const viewedRef = useRef(null);
  useEffect(() => {
    if (backendEnabled && id && truck && viewedRef.current !== id && !isAdmin) {
      viewedRef.current = id;
      recordView('food_truck', id);
    }
  }, [id, backendEnabled, truck, isAdmin]);

  if (!truck) {
    if (fetching) return <DetailSkeleton tint={colors.foodTruckLight} />;
    return (
      <View style={styles.notFound}>
        <ThemedText size="title" weight="bold">Food truck not found</ThemedText>
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center', paddingHorizontal: spacing.lg }}>
          This stop may have ended or been taken down.
        </ThemedText>
        <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <ThemedText size="body" weight="bold" color={colors.textInverse}>Go Back</ThemedText>
        </Pressable>
      </View>
    );
  }

  const openMaps = () => {
    const loc = (truck.address || truck.locationName || '').trim();
    if (!loc) return;
    const q = encodeURIComponent(loc);
    const url = Platform.select({
      ios: `maps:0,0?q=${q}`,
      android: `geo:0,0?q=${q}`,
      default: `https://maps.google.com/?q=${q}`,
    });
    Linking.openURL(url).catch(() => Linking.openURL(`https://maps.google.com/?q=${q}`));
  };

  const onShare = () => {
    Share.share({
      message: `${truck.name} (${truck.cuisine})\n${formatLongDate(truck.date)} · ${truck.startTime} to ${truck.endTime}\n${[truck.locationName, truck.address].filter(Boolean).join(', ')}${shareFooter(shareUrl('food-truck', truck.id))}`,
    }).catch(() => {});
  };

  const following = isFollowing(truck.name);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
      <View style={styles.hero}>
        <ThemedText style={{ fontSize: 80 }}>{CUISINE_EMOJI[truck.cuisine] || '🍴'}</ThemedText>
        <View style={styles.typeBadge}>
          <ThemedText size="small" weight="bold" color={colors.textInverse}>
            {truck.cuisine}
          </ThemedText>
        </View>
        {truck.pending ? (
          <View style={styles.pendingBadge}>
            <ThemedText size="tiny" weight="bold" color={colors.accent}>
              ⏳ PENDING REVIEW
            </ThemedText>
          </View>
        ) : null}
      </View>

      <View style={styles.content}>
        <ThemedText size="large" weight="bold">{truck.name}</ThemedText>
        {isAdmin ? (
          <View style={styles.viewsRow}>
            <Ionicons name="eye" size={16} color={colors.textMuted} />
            <ThemedText size="small" color={colors.textMuted}>{truck.viewCount ?? 0} views</ThemedText>
          </View>
        ) : null}

        <Pressable style={({ pressed }) => [styles.directionsBtn, pressed && { opacity: 0.85 }]} onPress={openMaps}>
          <Ionicons name="navigate" size={24} color={colors.textInverse} />
          <ThemedText size="subtitle" weight="bold" color={colors.textInverse}>
            Get Directions
          </ThemedText>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.85 }]} onPress={onShare}>
          <Ionicons name="share-outline" size={22} color={colors.foodTruck} />
          <ThemedText size="body" weight="bold" color={colors.foodTruck}>
            Share this truck
          </ThemedText>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.shareBtn, following && styles.followBtnActive, pressed && { opacity: 0.85 }]}
          onPress={() => toggleFollow(truck.name)}
          accessibilityRole="button"
          accessibilityLabel={following ? `Following ${truck.name}` : `Follow ${truck.name} for new stops`}
        >
          <Ionicons
            name={following ? 'notifications' : 'notifications-outline'}
            size={22}
            color={following ? colors.textInverse : colors.foodTruck}
          />
          <ThemedText size="body" weight="bold" color={following ? colors.textInverse : colors.foodTruck}>
            {following ? 'Following' : 'Follow for new stops'}
          </ThemedText>
        </Pressable>

        <View style={styles.infoCard}>
          <InfoRow
            icon="calendar"
            label="When"
            value={`${formatLongDate(truck.date)}\n${truck.startTime} to ${truck.endTime}`}
          />
          <View style={styles.divider} />
          <InfoRow
            icon="location"
            label="Where (tap for directions)"
            value={`${truck.locationName}\n${truck.address}`}
            onPress={openMaps}
          />
          <View style={styles.divider} />
          <InfoRow icon="restaurant" label="Cuisine" value={truck.cuisine} />
        </View>

        {truck.note ? (
          <>
            <ThemedText size="subtitle" weight="bold" style={styles.sectionTitle}>
              On the menu
            </ThemedText>
            <ThemedText size="body" style={{ lineHeight: 28 }}>
              {truck.note}
            </ThemedText>
          </>
        ) : null}
      </View>

      <FeatureButton kind="food_truck" id={truck.id} featured={truck.featured} featuredUntil={truck.featuredUntil} />

      {/* Owner path — claim the truck, opens the claim form prefilled */}
      <Pressable
        style={({ pressed }) => [styles.claimBtn, pressed && { opacity: 0.85 }]}
        onPress={() => router.push({ pathname: '/claim', params: { name: truck.name, kind: 'food_truck' } })}
        accessibilityRole="button"
      >
        <Ionicons name="ribbon-outline" size={18} color={colors.textMuted} />
        <ThemedText size="small" weight="bold" color={colors.textMuted}>Is this your truck? Claim it</ThemedText>
      </Pressable>

      <ReportButton kind="food_truck" id={truck.id} />
      <AdBanner />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  claimBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: spacing.md, marginTop: spacing.xs,
  },
  screen: { flex: 1, backgroundColor: colors.background },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
    backgroundColor: colors.foodTruckLight,
  },
  typeBadge: {
    backgroundColor: colors.foodTruck,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  pendingBadge: {
    backgroundColor: colors.accentLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  content: { padding: spacing.md },
  viewsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  directionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.foodTruck,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.md,
    minHeight: 56,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.foodTruck,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    minHeight: 52,
  },
  followBtnActive: { backgroundColor: colors.foodTruck, borderColor: colors.foodTruck },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.lg,
    paddingVertical: spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  infoIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.foodTruckLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.md + 40 + spacing.md,
  },
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.sm },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    backgroundColor: colors.background,
  },
  primaryBtn: {
    backgroundColor: colors.foodTruck,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
});
