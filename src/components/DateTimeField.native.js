import React, { useState } from 'react';
import { View, Pressable, Platform, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import { colors, spacing, radius } from '../theme/theme';
import { formatLongDate, formatTime } from '../utils/dates';

// Tappable field that opens a native calendar (date) or scroll wheel (time).
export default function DateTimeField({
  value,
  onChange,
  mode = 'date',
  placeholder = mode === 'date' ? 'Tap to pick a date' : 'Tap to pick a time',
  accent = colors.primary,
  minimumDate,
}) {
  const [show, setShow] = useState(false);

  const label = value
    ? mode === 'date'
      ? formatLongDate(value)
      : formatTime(value)
    : placeholder;

  const handleChange = (event, selected) => {
    if (Platform.OS === 'android') {
      setShow(false);
      if (event.type === 'set' && selected) onChange(selected);
    } else if (selected) {
      onChange(selected);
    }
  };

  // iOS fires onChange only when the user actually scrolls/taps the wheel, so a
  // user who opens the picker, sees the wheel centered on a value, and taps Done
  // without moving it would leave the field silently empty (its label still says
  // "Tap to pick..."). That is a dead-end for a required field. Seed the value the
  // wheel already displays (value || now, clamped to any future minimum) into
  // state on open, so what they see is what gets saved.
  const toggle = () => {
    const opening = !show;
    if (opening && !value) {
      const seed = minimumDate && minimumDate.getTime() > Date.now() ? minimumDate : new Date();
      onChange(seed);
    }
    setShow(opening);
  };

  return (
    <View>
      <Pressable
        onPress={toggle}
        style={[styles.field, show && { borderColor: accent }]}
        accessibilityRole="button"
        accessibilityLabel={`${mode === 'date' ? 'Date' : 'Time'}: ${label}`}
      >
        <Ionicons
          name={mode === 'date' ? 'calendar-outline' : 'time-outline'}
          size={22}
          color={accent}
        />
        <ThemedText size="body" color={value ? colors.text : colors.textMuted} style={{ flex: 1 }}>
          {label}
        </ThemedText>
        <Ionicons name={show ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
      </Pressable>

      {show && (
        <View style={styles.pickerWrap}>
          <DateTimePicker
            value={value || new Date()}
            mode={mode}
            display={mode === 'date' ? 'inline' : 'spinner'}
            onChange={handleChange}
            minimumDate={minimumDate}
            themeVariant="light"
            accentColor={accent}
            style={{ alignSelf: 'stretch' }}
          />
          {Platform.OS === 'ios' && (
            <Pressable
              onPress={() => setShow(false)}
              style={[styles.doneBtn, { backgroundColor: accent }]}
            >
              <ThemedText size="body" weight="bold" color={colors.textInverse}>
                Done
              </ThemedText>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    minHeight: 52,
  },
  pickerWrap: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  doneBtn: {
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
});
