import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import { colors, spacing, radius } from '../theme/theme';

// The translucent "Post Sale" / "Post Stop" button in the CityHeaderControl
// trailing slot on the sales + trucks feeds.
export default function PostButton({ label, onPress, scale = 1, accessibilityLabel }) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.btn}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
    >
      <Ionicons name="add" size={22 * Math.min(scale, 1.2)} color={colors.textInverse} />
      <ThemedText size="small" weight="bold" color={colors.textInverse}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    minHeight: 44,
  },
});
