import React from 'react';
import { View, StyleSheet } from 'react-native';
import ThemedText from './ThemedText';
import { calendarBits } from '../utils/dates';
import { colors, radius } from '../theme/theme';

// A small calendar-style date block (echoes the app's calendar-pin logo). Tinted
// in the caller's accent color so each kind of listing keeps its identity.
export default function DateChip({ date, accent = colors.primary, scale = 1 }) {
  const { weekday, day, month } = calendarBits(date);
  const s = Math.min(scale, 1.2);
  return (
    <View style={[styles.chip, { width: Math.round(58 * s) }]}>
      <View style={[styles.head, { backgroundColor: accent }]}>
        <ThemedText size="tiny" weight="bold" color={colors.textInverse}>
          {weekday}
        </ThemedText>
      </View>
      <View style={[styles.body, { backgroundColor: accent + '14' }]}>
        <ThemedText weight="bold" color={accent} style={{ fontSize: Math.round(23 * s) }}>
          {day}
        </ThemedText>
        <ThemedText size="tiny" color={colors.textMuted} style={{ marginTop: -1 }}>
          {month}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'flex-start',
  },
  head: { paddingVertical: 3, alignItems: 'center', justifyContent: 'center' },
  body: { paddingTop: 5, paddingBottom: 6, alignItems: 'center', justifyContent: 'center' },
});
