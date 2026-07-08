import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme/theme';

// A card-shaped placeholder shown while a list loads — reads as "content is
// coming" instead of a bare spinner. Static (no animation) to stay lightweight.
function SkeletonCard() {
  return (
    <View style={styles.card}>
      <View style={styles.chip} />
      <View style={styles.body}>
        <View style={[styles.line, { width: '34%', height: 12 }]} />
        <View style={[styles.line, { width: '88%', height: 18, marginTop: 6 }]} />
        <View style={[styles.line, { width: '58%' }]} />
        <View style={[styles.line, { width: '46%' }]} />
      </View>
    </View>
  );
}

export default function SkeletonList({ count = 6 }) {
  return (
    <View style={{ paddingTop: spacing.sm }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

const block = colors.skeleton;

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chip: {
    width: 58,
    height: 66,
    borderRadius: radius.md,
    backgroundColor: block,
  },
  body: { flex: 1, gap: spacing.sm, paddingTop: spacing.xxs },
  line: {
    height: 13,
    borderRadius: 6,
    backgroundColor: block,
  },
});
