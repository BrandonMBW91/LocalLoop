import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import { colors, spacing, radius } from '../theme/theme';

// The secondary temporal toggle used on the sales/trucks feeds ("This Week",
// "Today"): outlined in `accent` with a faint `tintLight` fill when off, solid
// `accent` when on.
export default function ToggleChip({ icon, label, on, onPress, accent, tintLight }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: tintLight, borderColor: accent }, on && { backgroundColor: accent }]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Ionicons name={icon} size={18} color={on ? colors.textInverse : accent} />
      <ThemedText size="small" weight="bold" color={on ? colors.textInverse : accent}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    marginRight: spacing.sm,
    minHeight: 44,
  },
});
