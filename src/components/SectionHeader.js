import React from 'react';
import { View, StyleSheet } from 'react-native';
import ThemedText from './ThemedText';
import { colors, spacing } from '../theme/theme';

// Sticky list header for the time-grouped lists. `accent` lets each tab use its
// own theme color; `unit` controls the count word (event / sale / truck).
export default function SectionHeader({ title, count, accent = colors.primary, unit = 'event' }) {
  const highlight = title === 'Featured' || title === 'Today' || title === 'Tomorrow';
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <ThemedText size="subtitle" weight="bold" color={highlight ? accent : colors.text}>
          {title === 'Featured' ? '★ Featured' : title}
        </ThemedText>
        <ThemedText size="small" color={colors.textMuted}>
          {count} {count === 1 ? unit : `${unit}s`}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    paddingBottom: spacing.xs,
  },
});
