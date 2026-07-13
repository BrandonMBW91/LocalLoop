import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Linking, Platform, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ThemedText from '../../src/components/ThemedText';
import FadeInImage from '../../src/components/FadeInImage';
import AdBanner from '../../src/components/AdBanner';
import DetailSkeleton from '../../src/components/DetailSkeleton';
import ReportButton from '../../src/components/ReportButton';
import FeatureButton from '../../src/components/FeatureButton';
import { useApp } from '../../src/context/AppContext';
import { recordView, fetchOneById } from '../../src/lib/db';
import { colors, spacing, radius } from '../../src/theme/theme';
import { dateRangeLabel } from '../../src/utils/dates';
import { shareUrl, shareFooter } from '../../src/lib/links';
import { addToCalendarUrl } from '../../src/utils/calendar';

function InfoRow({ icon, label, value, onPress }) {
  const Wrap = onPress ? Pressable : View;
  return (
    <Wrap style={styles.infoRow} onPress={onPress}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={22} color={colors.garageSale} />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText size="small" color={colors.textMuted}>{label}</ThemedText>
        <ThemedText size="body" weight="semibold" color={onPress ? colors.garageSale : colors.text}>
          {value}
        </ThemedText>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={20} color={colors.textMuted} /> : null}
    </Wrap>
  );
}

export default function GarageSaleDetailScreen() {
  const { id: rawId } = useLocalSearchParams();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const router = useRouter();
  const { findGarageSaleById, backendEnabled, isAdmin, toggleSavedSale, isSaleSaved } = useApp();
  const cached = findGarageSaleById(id);
  const [fetched, setFetched] = useState(null);
  const [fetching, setFetching] = useState(!cached && backendEnabled && !!id);
  useEffect(() => {
    if (!cached && backendEnabled && id) {
      let ok = true;
      setFetching(true);
      fetchOneById('garage_sale', id)
        .then((s) => { if (ok) { setFetched(s); setFetching(false); } })
        .catch(() => { if (ok) setFetching(false); });
      return () => { ok = false; };
    }
    setFetching(false);
  }, [cached, backendEnabled, id]);
  const sale = cached || fetched;

  // Record the view once per id, but only AFTER the sale has resolved, so a deep
  // link to a deleted/invalid sale (which renders "not found") and remounts don't
  // inflate the view counts shown to advertisers. Owner/admin views are excluded.
  const viewedRef = useRef(null);
  useEffect(() => {
    if (backendEnabled && id && sale && viewedRef.current !== id && !isAdmin) {
      viewedRef.current = id;
      recordView('garage_sale', id);
    }
  }, [id, backendEnabled, sale, isAdmin]);

  if (!sale) {
    if (fetching) return <DetailSkeleton tint={colors.garageSaleLight} />;
    return (
      <View style={styles.notFound}>
        <ThemedText size="title" weight="bold">Sale not found</ThemedText>
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center', paddingHorizontal: spacing.lg }}>
          This sale may have ended or been taken down.
        </ThemedText>
        <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <ThemedText size="body" weight="bold" color={colors.textInverse}>Go Back</ThemedText>
        </Pressable>
      </View>
    );
  }

  const openMaps = () => {
    const loc = (sale.address || '').trim();
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
      message: `${sale.title}\n${dateRangeLabel(sale.start, sale.end)} · ${sale.dailyStart} to ${sale.dailyEnd}\n${sale.address}${shareFooter(shareUrl('garage-sale', sale.id))}`,
      url: shareUrl('garage-sale', sale.id), // iOS uses this to unfurl a rich preview card
    }).catch(() => {});
  };

  const onAddToCalendar = () => {
    const url = addToCalendarUrl({
      title: sale.title,
      start: sale.start,
      end: sale.end,
      location: sale.address,
      details: `${sale.dailyStart} to ${sale.dailyEnd}${sale.note ? '. ' + sale.note : ''}`,
    });
    Linking.openURL(url).catch(() => {});
  };

  const saved = isSaleSaved(sale.id);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
      <View style={styles.hero}>
        <ThemedText style={{ fontSize: 80 }}>🪧</ThemedText>
        <View style={styles.typeBadge}>
          <ThemedText size="small" weight="bold" color={colors.textInverse}>
            {sale.type}
          </ThemedText>
        </View>
        {sale.pending ? (
          <View style={styles.pendingBadge}>
            <ThemedText size="tiny" weight="bold" color={colors.accent}>
              ⏳ PENDING REVIEW
            </ThemedText>
          </View>
        ) : null}
      </View>

      <View style={styles.content}>
        <ThemedText size="large" weight="bold">{sale.title}</ThemedText>
        {isAdmin ? (
          <View style={styles.viewsRow}>
            <Ionicons name="eye" size={16} color={colors.textMuted} />
            <ThemedText size="small" color={colors.textMuted}>{sale.viewCount ?? 0} views</ThemedText>
          </View>
        ) : null}

        {/* Photo gallery */}
        {sale.images?.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: spacing.md }}
            contentContainerStyle={{ gap: spacing.sm }}
          >
            {sale.images.map((uri, i) => (
              <FadeInImage key={i} source={{ uri }} style={styles.galleryImg} resizeMode="cover" />
            ))}
          </ScrollView>
        ) : null}

        {/* Big primary directions button — the main action for a garage sale */}
        <Pressable style={({ pressed }) => [styles.directionsBtn, pressed && { opacity: 0.85 }]} onPress={openMaps}>
          <Ionicons name="navigate" size={24} color={colors.textInverse} />
          <ThemedText size="subtitle" weight="bold" color={colors.textInverse}>
            Get Directions
          </ThemedText>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.85 }]} onPress={onShare}>
          <Ionicons name="share-outline" size={22} color={colors.garageSale} />
          <ThemedText size="body" weight="bold" color={colors.garageSale}>
            Share this sale
          </ThemedText>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.85 }]} onPress={onAddToCalendar}>
          <Ionicons name="calendar-outline" size={22} color={colors.garageSale} />
          <ThemedText size="body" weight="bold" color={colors.garageSale}>
            Add to Calendar
          </ThemedText>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.shareBtn, saved && styles.saveBtnActive, pressed && { opacity: 0.85 }]}
          onPress={() => toggleSavedSale(sale.id, sale)}
          accessibilityRole="button"
          accessibilityLabel={saved ? 'Saved, we will remind you before it starts' : 'Save this sale and get a reminder'}
        >
          <Ionicons name={saved ? 'heart' : 'heart-outline'} size={22} color={saved ? colors.textInverse : colors.garageSale} />
          <ThemedText size="body" weight="bold" color={saved ? colors.textInverse : colors.garageSale}>
            {saved ? 'Saved' : 'Save & remind me'}
          </ThemedText>
        </Pressable>
        <ThemedText size="small" color={colors.textMuted} style={{ textAlign: 'center', marginTop: spacing.xs }}>
          {saved ? "We'll remind you before it starts." : 'Save it and get a reminder before it starts.'}
        </ThemedText>

        <View style={styles.infoCard}>
          <InfoRow
            icon="calendar"
            label="When"
            value={`${dateRangeLabel(sale.start, sale.end)}\n${sale.dailyStart} to ${sale.dailyEnd}`}
          />
          <View style={styles.divider} />
          <InfoRow
            icon="location"
            label="Address (tap for directions)"
            value={sale.address}
            onPress={openMaps}
          />
          <View style={styles.divider} />
          <InfoRow icon="person" label="Hosted by" value={sale.host || 'Community submission'} />
        </View>

        {/* Items grid */}
        {sale.items?.length ? (
          <>
            <ThemedText size="subtitle" weight="bold" style={styles.sectionTitle}>
              What’s for sale
            </ThemedText>
            <View style={styles.itemsGrid}>
              {sale.items.map((item) => (
                <View key={item} style={styles.itemTag}>
                  <ThemedText size="small" weight="semibold" color={colors.garageSale}>
                    {item}
                  </ThemedText>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {sale.note ? (
          <>
            <ThemedText size="subtitle" weight="bold" style={styles.sectionTitle}>
              Details
            </ThemedText>
            <ThemedText size="body" style={{ lineHeight: 28 }}>
              {sale.note}
            </ThemedText>
          </>
        ) : null}
      </View>

      <FeatureButton kind="garage_sale" id={sale.id} featured={sale.featured} featuredUntil={sale.featuredUntil} />
      <ReportButton kind="garage_sale" id={sale.id} />
      <AdBanner />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
    backgroundColor: colors.garageSaleLight,
  },
  typeBadge: {
    backgroundColor: colors.garageSale,
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
  galleryImg: {
    width: 220,
    height: 165,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  directionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.garageSale,
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
    borderColor: colors.garageSale,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    minHeight: 52,
  },
  saveBtnActive: { backgroundColor: colors.garageSale, borderColor: colors.garageSale },
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
    backgroundColor: colors.garageSaleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.md + 40 + spacing.md,
  },
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.sm },
  itemsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  itemTag: {
    backgroundColor: colors.garageSaleLight,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    backgroundColor: colors.background,
  },
  primaryBtn: {
    backgroundColor: colors.garageSale,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
});
