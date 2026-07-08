import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { spacing } from '../theme/theme';

// Horizontal, scrollable filter strip that holds a screen's chips (and optional
// leading toggle). Just the scroll container — each screen supplies the chips.
export default function FilterRow({ children }) {
  return (
    <View style={styles.row}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content}>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginTop: spacing.md },
  content: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, alignItems: 'center' },
});
