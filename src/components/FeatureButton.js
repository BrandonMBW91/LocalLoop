import React, { useState } from 'react';
import { View, StyleSheet, Pressable, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import { useApp } from '../context/AppContext';
import { setFeatured } from '../lib/db';
import { colors, spacing, radius } from '../theme/theme';

// Admin-only control to promote a listing to the top of its list for a paid
// window. Hidden entirely for non-admins. kind: 'event' | 'garage_sale' | 'food_truck'.
export default function FeatureButton({ kind, id, featured, featuredUntil }) {
  const { isAdmin, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  if (!isAdmin) return null;

  const apply = async (days) => {
    setBusy(true);
    try {
      await setFeatured(kind, id, days);
      await refresh();
    } catch (e) {
      Alert.alert('Could not update', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const until = featuredUntil ? new Date(featuredUntil) : null;
  const untilLabel = until
    ? until.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Ionicons name="star" size={18} color={colors.accent} />
        <ThemedText size="small" weight="bold" color={colors.accent} style={{ letterSpacing: 0.5 }}>
          MODERATOR · PROMOTION
        </ThemedText>
      </View>

      <ThemedText size="small" color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
        {featured
          ? `Featured${untilLabel ? ` until ${untilLabel}` : ''} — floats to the top of its list with a ★ badge.`
          : 'Not featured. Promote it to the top of its list.'}
      </ThemedText>

      {busy ? (
        <ActivityIndicator color={colors.accent} style={{ paddingVertical: spacing.sm }} />
      ) : (
        <View style={styles.row}>
          <Pressable style={[styles.btn, styles.outline]} onPress={() => apply(7)}>
            <ThemedText size="small" weight="bold" color={colors.accent}>Feature 7 days</ThemedText>
          </Pressable>
          <Pressable style={[styles.btn, styles.solid]} onPress={() => apply(30)}>
            <ThemedText size="small" weight="bold" color={colors.textInverse}>Feature 30 days</ThemedText>
          </Pressable>
          {featured ? (
            <Pressable style={[styles.btn, styles.remove]} onPress={() => apply(0)}>
              <ThemedText size="small" weight="bold" color={colors.danger}>Remove</ThemedText>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accentLight,
    backgroundColor: colors.surface,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  btn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outline: { borderWidth: 1.5, borderColor: colors.accent, backgroundColor: colors.surface },
  solid: { backgroundColor: colors.accent },
  remove: { borderWidth: 1.5, borderColor: colors.danger, backgroundColor: colors.surface },
});
