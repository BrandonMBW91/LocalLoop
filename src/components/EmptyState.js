import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import { colors, spacing, radius, textOn } from '../theme/theme';

// A friendly, consistent "nothing here yet" state with an optional primary
// action. Used across the lists, the saved screen, etc.
export default function EmptyState({ icon, title, body, actionLabel, onAction, actionIcon = 'add-circle', secondaryLabel, onSecondary, secondaryIcon = 'share-outline', accent = colors.primary }) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.iconCircle, { backgroundColor: accent + '14' }]}>
        <Ionicons name={icon} size={42} color={accent} />
      </View>
      <ThemedText size="subtitle" weight="bold" style={{ textAlign: 'center' }}>
        {title}
      </ThemedText>
      {body ? (
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
          {body}
        </ThemedText>
      ) : null}
      {actionLabel && onAction ? (
        <Pressable style={({ pressed }) => [styles.btn, { backgroundColor: accent }, pressed && { opacity: 0.85 }]} onPress={onAction}>
          <Ionicons name={actionIcon} size={22} color={textOn(accent)} />
          <ThemedText size="body" weight="bold" color={textOn(accent)}>
            {actionLabel}
          </ThemedText>
        </Pressable>
      ) : null}
      {secondaryLabel && onSecondary ? (
        <Pressable style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.6 }]} onPress={onSecondary} accessibilityRole="button" accessibilityLabel={secondaryLabel}>
          <Ionicons name={secondaryIcon} size={18} color={accent} />
          <ThemedText size="body" weight="semibold" color={accent}>
            {secondaryLabel}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    minHeight: 52,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
});
