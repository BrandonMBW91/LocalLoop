import React, { useEffect, useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Pressable, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { fetchPending, setPostStatus, fetchReported, dismissReports } from '../src/lib/db';
import { colors, spacing, radius, categoryColor } from '../src/theme/theme';
import { formatShortDate } from '../src/utils/dates';

const KIND_LABEL = { event: 'EVENT', garage_sale: 'GARAGE SALE', food_truck: 'FOOD TRUCK' };
const KIND_COLOR = {
  event: colors.primary,
  garage_sale: colors.garageSale,
  food_truck: colors.foodTruck,
};

function itemFields(item) {
  return {
    title: item.title || item.name || 'Untitled',
    when: item.start || item.date,
    where: item.venue || item.locationName || item.address,
    detail: item.description || item.note || '',
    submittedBy: item.host || '',
  };
}

export default function ModerateScreen() {
  const { isAdmin, refresh, refreshPendingCount } = useApp();
  const [items, setItems] = useState([]);
  const [reported, setReported] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pending, flagged] = await Promise.all([fetchPending(), fetchReported()]);
      setItems(pending);
      setReported(flagged);
    } catch (e) {
      Alert.alert('Could not load', e?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const decide = async (item, status) => {
    setBusyId(item.id);
    try {
      await setPostStatus(item.kind, item.id, status);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      refreshPendingCount();
      refresh(); // refresh public lists (approve adds it, reject removes it)
    } catch (e) {
      Alert.alert('Could not update', e?.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  // Keep a reported listing: clear its reports, leave it published.
  const keepReported = async (item) => {
    setBusyId(item.id);
    try {
      await dismissReports(item.kind, item.id);
      setReported((prev) => prev.filter((i) => i.id !== item.id));
    } catch (e) {
      Alert.alert('Could not update', e?.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  // Remove a reported listing: reject it (hides it) and clear its reports.
  const removeReported = async (item) => {
    setBusyId(item.id);
    try {
      await setPostStatus(item.kind, item.id, 'rejected');
      await dismissReports(item.kind, item.id);
      setReported((prev) => prev.filter((i) => i.id !== item.id));
      refresh(); // drop it from the public lists
    } catch (e) {
      Alert.alert('Could not update', e?.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed" size={40} color={colors.textMuted} />
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
          This area is for moderators. Sign in with your admin account to review submissions.
        </ThemedText>
      </View>
    );
  }

  const nothing = items.length === 0 && reported.length === 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
    >
      {loading && nothing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : nothing ? (
        <View style={styles.center}>
          <ThemedText style={{ fontSize: 44 }}>✅</ThemedText>
          <ThemedText size="subtitle" weight="bold">All clear</ThemedText>
          <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
            Nothing waiting for review. Clean posts go live automatically.
          </ThemedText>
        </View>
      ) : (
        <>
          {/* Reported posts — already live, but someone flagged them. */}
          {reported.length > 0 ? (
            <>
              <View style={styles.sectionHeader}>
                <Ionicons name="flag" size={18} color={colors.danger} />
                <ThemedText size="subtitle" weight="bold" color={colors.danger}>
                  Reported ({reported.length})
                </ThemedText>
              </View>
              <ThemedText size="small" color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
                These are published but a user flagged them. Keep them up, or remove them.
              </ThemedText>

              {reported.map((item) => {
                const f = itemFields(item);
                const accent = KIND_COLOR[item.kind] || colors.primary;
                const busy = busyId === item.id;
                return (
                  <View key={`rep-${item.kind}-${item.id}`} style={[styles.card, styles.reportedCard]}>
                    <View style={styles.kindRow}>
                      <View style={[styles.kindBadge, { backgroundColor: accent }]}>
                        <ThemedText size="tiny" weight="bold" color={colors.textInverse}>
                          {KIND_LABEL[item.kind]}
                        </ThemedText>
                      </View>
                      <View style={[styles.kindBadge, styles.flagBadge]}>
                        <ThemedText size="tiny" weight="bold" color={colors.danger}>
                          🚩 {item.reportCount} {item.reportCount === 1 ? 'report' : 'reports'}
                        </ThemedText>
                      </View>
                    </View>

                    <ThemedText size="subtitle" weight="bold">{f.title}</ThemedText>
                    {item.reasons?.length ? (
                      <ThemedText size="small" color={colors.danger} style={{ marginTop: 2 }}>
                        Reason: {item.reasons.join(', ')}
                      </ThemedText>
                    ) : null}
                    {f.when ? (
                      <View style={styles.metaRow}>
                        <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
                        <ThemedText size="small" color={colors.textMuted}>{formatShortDate(f.when)}</ThemedText>
                      </View>
                    ) : null}
                    {f.where ? (
                      <View style={styles.metaRow}>
                        <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                        <ThemedText size="small" color={colors.textMuted} numberOfLines={1}>{f.where}</ThemedText>
                      </View>
                    ) : null}
                    {f.detail ? (
                      <ThemedText size="small" color={colors.text} style={{ marginTop: 6 }} numberOfLines={4}>
                        {f.detail}
                      </ThemedText>
                    ) : null}

                    <View style={styles.actions}>
                      <Pressable
                        style={[styles.btn, styles.reject, busy && { opacity: 0.5 }]}
                        onPress={() => removeReported(item)}
                        disabled={busy}
                      >
                        <Ionicons name="trash-outline" size={20} color={colors.danger} />
                        <ThemedText size="body" weight="bold" color={colors.danger}>Remove</ThemedText>
                      </Pressable>
                      <Pressable
                        style={[styles.btn, styles.keep, busy && { opacity: 0.5 }]}
                        onPress={() => keepReported(item)}
                        disabled={busy}
                      >
                        {busy ? (
                          <ActivityIndicator size="small" color={colors.textInverse} />
                        ) : (
                          <>
                            <Ionicons name="checkmark" size={20} color={colors.textInverse} />
                            <ThemedText size="body" weight="bold" color={colors.textInverse}>Keep</ThemedText>
                          </>
                        )}
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </>
          ) : null}

          {/* Pending submissions — held by the auto-filter for a human check. */}
          {items.length > 0 ? (
            <>
              <View style={styles.sectionHeader}>
                <Ionicons name="time-outline" size={18} color={colors.accent} />
                <ThemedText size="subtitle" weight="bold">
                  Pending review ({items.length})
                </ThemedText>
              </View>
              <ThemedText size="small" color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
                These passed the automatic filter but looked worth a human check (a link,
                a phone number, or flagged wording). Approve to publish, or reject.
              </ThemedText>

              {items.map((item) => {
                const f = itemFields(item);
                const accent = KIND_COLOR[item.kind] || colors.primary;
                const busy = busyId === item.id;
                return (
                  <View key={`${item.kind}-${item.id}`} style={styles.card}>
                    <View style={styles.kindRow}>
                      <View style={[styles.kindBadge, { backgroundColor: accent }]}>
                        <ThemedText size="tiny" weight="bold" color={colors.textInverse}>
                          {KIND_LABEL[item.kind]}
                        </ThemedText>
                      </View>
                    </View>

                    <ThemedText size="subtitle" weight="bold">{f.title}</ThemedText>
                    {f.when ? (
                      <View style={styles.metaRow}>
                        <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
                        <ThemedText size="small" color={colors.textMuted}>{formatShortDate(f.when)}</ThemedText>
                      </View>
                    ) : null}
                    {f.where ? (
                      <View style={styles.metaRow}>
                        <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                        <ThemedText size="small" color={colors.textMuted} numberOfLines={1}>{f.where}</ThemedText>
                      </View>
                    ) : null}
                    {f.detail ? (
                      <ThemedText size="small" color={colors.text} style={{ marginTop: 6 }} numberOfLines={4}>
                        {f.detail}
                      </ThemedText>
                    ) : null}

                    <View style={styles.actions}>
                      <Pressable
                        style={[styles.btn, styles.reject, busy && { opacity: 0.5 }]}
                        onPress={() => decide(item, 'rejected')}
                        disabled={busy}
                      >
                        <Ionicons name="close" size={20} color={colors.danger} />
                        <ThemedText size="body" weight="bold" color={colors.danger}>Reject</ThemedText>
                      </Pressable>
                      <Pressable
                        style={[styles.btn, styles.approve, busy && { opacity: 0.5 }]}
                        onPress={() => decide(item, 'approved')}
                        disabled={busy}
                      >
                        {busy ? (
                          <ActivityIndicator size="small" color={colors.textInverse} />
                        ) : (
                          <>
                            <Ionicons name="checkmark" size={20} color={colors.textInverse} />
                            <ThemedText size="body" weight="bold" color={colors.textInverse}>Approve</ThemedText>
                          </>
                        )}
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  reportedCard: { borderColor: colors.danger, borderWidth: 1.5 },
  kindRow: { flexDirection: 'row', marginBottom: 2, gap: 6, flexWrap: 'wrap' },
  kindBadge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  flagBadge: { backgroundColor: colors.accentLight },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    minHeight: 50,
  },
  reject: { borderWidth: 1.5, borderColor: colors.danger, backgroundColor: colors.surface },
  approve: { backgroundColor: colors.success },
  keep: { backgroundColor: colors.primary },
});
