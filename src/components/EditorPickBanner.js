import React from 'react';
import { View, StyleSheet, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import { colors, spacing, radius } from '../theme/theme';

// The hand-curated "This Week's Pick" — the local human voice at the top of the
// events list. Renders nothing unless an admin has set one for this town.
export default function EditorPickBanner({ pick }) {
  if (!pick || !pick.title) return null;
  const open = () => pick.linkUrl && Linking.openURL(pick.linkUrl).catch(() => {});

  return (
    <Pressable
      onPress={pick.linkUrl ? open : undefined}
      style={styles.card}
      accessibilityRole={pick.linkUrl ? 'link' : 'text'}
      accessibilityLabel={`This week's pick: ${pick.title}`}
    >
      <View style={styles.tagRow}>
        <Ionicons name="star" size={13} color={colors.accent} />
        <ThemedText size="tiny" weight="bold" color={colors.accent} style={{ letterSpacing: 0.5 }}>
          THIS WEEK'S PICK
        </ThemedText>
      </View>
      <ThemedText size="subtitle" weight="bold" style={{ marginTop: 4 }}>
        {pick.title}
      </ThemedText>
      {pick.note ? (
        <ThemedText size="small" color={colors.textMuted} style={{ marginTop: 4, lineHeight: 21 }}>
          {pick.note}
        </ThemedText>
      ) : null}
      {pick.detail ? (
        <View style={styles.detailRow}>
          <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
          <ThemedText size="small" color={colors.textMuted}>{pick.detail}</ThemedText>
          {pick.linkUrl ? <Ionicons name="open-outline" size={14} color={colors.accent} /> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
});
