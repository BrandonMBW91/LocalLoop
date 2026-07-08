import React, { useState } from 'react';
import { View, StyleSheet, Pressable, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ThemedText from './ThemedText';
import { useApp } from '../context/AppContext';
import { setFeatured, setPostStatus } from '../lib/db';
import { colors, spacing, radius } from '../theme/theme';

const KIND_NOUN = { event: 'event', garage_sale: 'garage sale', food_truck: 'food truck' };

// Admin-only moderator panel on every detail screen: promote a listing, or
// remove (hide) this specific listing from the app. Hidden for non-admins.
// kind: 'event' | 'garage_sale' | 'food_truck'.
export default function FeatureButton({ kind, id, featured, featuredUntil }) {
  const { isAdmin, refresh } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!isAdmin) return null;

  const noun = KIND_NOUN[kind] || 'listing';

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

  const doRemove = async () => {
    setBusy(true);
    try {
      await setPostStatus(kind, id, 'rejected'); // hides it from every public list
      await refresh();
      router.back(); // it's gone now — return to the list
    } catch (e) {
      setBusy(false);
      Alert.alert('Could not remove', e?.message || 'Please try again.');
    }
  };

  const confirmRemove = () => {
    Alert.alert(
      `Remove this ${noun}?`,
      `It will be hidden from everyone in the app. You can restore it later from the database if needed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: doRemove },
      ]
    );
  };

  const until = featuredUntil ? new Date(featuredUntil) : null;
  const untilLabel = until
    ? until.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Ionicons name="shield-checkmark" size={18} color={colors.accent} />
        <ThemedText size="small" weight="bold" color={colors.accent} style={{ letterSpacing: 0.5 }}>
          MODERATOR TOOLS
        </ThemedText>
      </View>

      <ThemedText size="small" color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
        {featured
          ? `Featured${untilLabel ? ` until ${untilLabel}` : ''}. Floats to the top of its list with a ★ badge.`
          : 'Not featured. Promote it to the top of its list.'}
      </ThemedText>

      {busy ? (
        <ActivityIndicator color={colors.accent} style={{ paddingVertical: spacing.sm }} />
      ) : (
        <View style={styles.row}>
          <Pressable
            style={[styles.btn, styles.outline]}
            onPress={() => apply(7)}
            accessibilityRole="button"
            accessibilityLabel={`Feature this ${noun} for 7 days`}
          >
            <ThemedText size="small" weight="bold" color={colors.accent}>Feature 7 days</ThemedText>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.solid]}
            onPress={() => apply(30)}
            accessibilityRole="button"
            accessibilityLabel={`Feature this ${noun} for 30 days`}
          >
            <ThemedText size="small" weight="bold" color={colors.textInverse}>Feature 30 days</ThemedText>
          </Pressable>
          {featured ? (
            <Pressable
              style={[styles.btn, styles.remove]}
              onPress={() => apply(0)}
              accessibilityRole="button"
              accessibilityLabel={`Unfeature this ${noun}`}
            >
              <ThemedText size="small" weight="bold" color={colors.danger}>Unfeature</ThemedText>
            </Pressable>
          ) : null}
        </View>
      )}

      {!busy ? (
        <>
          <View style={styles.divider} />
          <Pressable
            style={styles.deleteBtn}
            onPress={confirmRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove this ${noun} from the app`}
          >
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
            <ThemedText size="small" weight="bold" color={colors.danger}>
              Remove this {noun} from the app
            </ThemedText>
          </Pressable>
        </>
      ) : null}
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
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs },
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
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
});
