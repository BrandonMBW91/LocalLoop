import React from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, baseFont } from '../theme/theme';

// The search box shared by every feed screen. `onSubmit(term)` is optional (the
// events screen uses it to log searches); the clear button and sizing behave the
// same everywhere.
export default function SearchBar({ value, onChange, placeholder, label, scale = 1, onSubmit }) {
  return (
    <View style={styles.wrap}>
      <Ionicons name="search" size={22} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, { fontSize: Math.round(baseFont.body * scale) }]}
        accessibilityLabel={label}
        returnKeyType="search"
        onSubmitEditing={onSubmit ? () => value.trim() && onSubmit(value.trim()) : undefined}
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChange('')} hitSlop={10} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={22} color={colors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 52,
  },
  input: { flex: 1, color: colors.text, paddingVertical: 12 },
});
