import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import ThemedText from './ThemedText';
import { colors, spacing, radius } from '../theme/theme';

// Horizontal filter pill. Large tap target, clear selected state.
export default function CategoryChip({ label, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`Filter by ${label}`}
    >
      {/* Same Android small-font hardening as ToggleChip: multi-word labels
          ("All Items", "Baby & Kids") must never wrap or shrink mid-relayout. */}
      <ThemedText
        size="small"
        weight={selected ? 'bold' : 'medium'}
        color={selected ? colors.textInverse : colors.text}
        numberOfLines={1}
        style={styles.label}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    marginRight: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    flexShrink: 0,
  },
  label: { flexShrink: 0 },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
});
