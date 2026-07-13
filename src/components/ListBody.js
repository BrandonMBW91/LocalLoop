import React from 'react';
import { View, SectionList, RefreshControl, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import AdBanner from './AdBanner';
import SectionHeader from './SectionHeader';
import SkeletonList from './SkeletonCard';
import EmptyState from './EmptyState';
import { colors, spacing, radius } from '../theme/theme';

// The shared body for the three feed screens (events / garage sales / food
// trucks): the time-grouped SectionList with sticky headers, interleaved ad
// banners, the offline banner, the "N found" count, pull-to-refresh, and the
// loading / no-match / nothing-yet empty states. A screen supplies its data
// (`sections`), how to render one card (`renderCard`), its accent + copy, and any
// extra header content (`headerExtras`, e.g. the events editor-pick + deals
// banners). Everything structural lives here so all three stay in lock-step and a
// fourth feed type is a thin wrapper.
export default function ListBody({
  sections,
  renderCard,
  accent = colors.primary,
  sectionUnit = 'event',
  refreshing,
  onRefresh,
  loadError,
  loadingData,
  countLabel,
  headerExtras = null,
  isFiltering,
  onClearFilters,
  emptyFilter,
  emptyFirst,
}) {
  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.key}
      renderItem={({ item }) => (item.type === 'ad' ? <AdBanner index={item.adIndex} /> : renderCard(item))}
      renderSectionHeader={({ section }) => (
        <SectionHeader title={section.title} count={section.count} accent={accent} unit={sectionUnit} />
      )}
      stickySectionHeadersEnabled
      removeClippedSubviews={Platform.OS === 'android'}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={11}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[accent]} tintColor={accent} />
      }
      ListHeaderComponent={
        <>
          {loadError ? (
            <View style={styles.offlineBanner}>
              <Ionicons name="cloud-offline-outline" size={18} color={colors.accent} />
              <ThemedText size="small" color={colors.accent} style={{ flex: 1 }}>
                Couldn't refresh. Showing saved listings. Pull down to try again.
              </ThemedText>
            </View>
          ) : null}
          {headerExtras}
          {sections.length === 0 ? null : (
            // Drive off having data, not loadingData, so the count doesn't blink
            // out on every pull-to-refresh (which flips loadingData true).
            <ThemedText size="small" color={colors.textMuted} style={styles.countLabel}>
              {countLabel}
            </ThemedText>
          )}
        </>
      }
      ListEmptyComponent={
        loadingData ? (
          <SkeletonList />
        ) : isFiltering ? (
          <EmptyState
            icon={emptyFilter.icon}
            title={emptyFilter.title}
            body={emptyFilter.body}
            actionLabel="Clear filters"
            onAction={onClearFilters}
            accent={accent}
          />
        ) : (
          <EmptyState
            icon={emptyFirst.icon}
            title={emptyFirst.title}
            body={emptyFirst.body}
            actionLabel={emptyFirst.actionLabel}
            onAction={emptyFirst.onAction}
            secondaryLabel={emptyFirst.secondaryLabel}
            onSecondary={emptyFirst.onSecondary}
            accent={accent}
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentLight,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  countLabel: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
});
