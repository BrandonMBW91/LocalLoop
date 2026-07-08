import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import { radius } from '../theme/theme';

// The small rounded badge used on every list card: a category / cuisine tag, a
// "HAPPENING NOW" / "TODAY" status, or the star "FEATURED" flag. `color` is the
// text (and icon) color; `bg` is its faint fill. Pass `icon` for a leading glyph
// (the star on featured items).
export default function Pill({ label, color, bg, icon }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={11} color={color} style={styles.icon} /> : null}
      <ThemedText size="tiny" weight="bold" color={color}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  icon: { marginRight: 3 },
});
