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
      <ThemedText
        size="small"
        weight={selected ? 'bold' : 'medium'}
        color={selected ? colors.textInverse : colors.text}
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
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
});
