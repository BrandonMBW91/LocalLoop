import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { CHANGELOG } from '../src/data/changelog';
import { BUILD } from '../src/version';
import { colors, spacing, radius } from '../src/theme/theme';

// Admin-only release log: every rev, what shipped in it, and when. Answers "what
// changed in 107?" and "which rev broke this?" without leaving the phone — useful
// exactly when something is wrong on a device and you cannot get to a terminal.
//
// The data is GENERATED from git by scripts/build-changelog.mjs (each entry is a BUILD
// bump in src/version.js; its `changes` are the commit subjects since the previous
// bump). Nothing here is typed by hand, so it cannot drift out of date.
//
// NOT SECRET. isAdmin hides the row and this screen from the UI, but CHANGELOG ships
// inside the public JS bundle like everything else in src/ — anyone can read it out of
// the bundle. That is fine for commit subjects; do not put anything in a commit subject
// you would not publish.
export default function ChangelogScreen() {
  const { isAdmin } = useApp();
  const [open, setOpen] = useState(CHANGELOG[0]?.rev ?? null);

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed" size={40} color={colors.textMuted} />
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
          This area is for moderators. Sign in with your admin account to see the release log.
        </ThemedText>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ThemedText size="small" color={colors.textMuted} style={styles.intro}>
        {CHANGELOG.length} releases. Generated from git, newest first. This device is on rev {BUILD}.
      </ThemedText>

      {CHANGELOG.map((entry) => {
        const isOpen = open === entry.rev;
        const running = entry.rev === BUILD;
        return (
          <View key={entry.rev} style={[styles.card, running && styles.cardRunning]}>
            <Pressable
              style={styles.head}
              onPress={() => setOpen(isOpen ? null : entry.rev)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              accessibilityLabel={`rev ${entry.rev}, ${entry.date}, ${entry.changes.length} changes`}
            >
              <View style={styles.revPill}>
                <ThemedText size="tiny" weight="bold" color={colors.textInverse}>{entry.rev}</ThemedText>
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText size="body" weight="bold">
                  rev {entry.rev}
                  {running ? '  · running here' : ''}
                </ThemedText>
                <ThemedText size="tiny" color={colors.textMuted}>
                  {entry.date} · {entry.changes.length} {entry.changes.length === 1 ? 'change' : 'changes'}
                </ThemedText>
              </View>
              <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
            </Pressable>

            {isOpen ? (
              <View style={styles.body}>
                {entry.whatsNew ? (
                  <View style={styles.whatsNew}>
                    <ThemedText size="tiny" weight="bold" color={colors.textMuted} style={styles.label}>
                      SHOWN TO USERS
                    </ThemedText>
                    <ThemedText size="small">{entry.whatsNew}</ThemedText>
                  </View>
                ) : null}
                {entry.changes.length ? (
                  entry.changes.map((c, i) => (
                    <View key={i} style={styles.change}>
                      <ThemedText size="small" color={colors.textMuted} style={styles.bullet}>•</ThemedText>
                      <ThemedText size="small" style={{ flex: 1 }}>{c}</ThemedText>
                    </View>
                  ))
                ) : (
                  <ThemedText size="small" color={colors.textMuted}>
                    No commits recorded between this rev and the one before it.
                  </ThemedText>
                )}
              </View>
            ) : null}
          </View>
        );
      })}

      <ThemedText size="tiny" color={colors.textMuted} style={styles.foot}>
        Regenerate with: node scripts/build-changelog.mjs
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl, backgroundColor: colors.background },
  intro: { marginBottom: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, overflow: 'hidden' },
  cardRunning: { borderColor: colors.primary },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, minHeight: 56 },
  // primaryFill, not primary: white text sits on this pill (3.50:1 on the base in dark).
  revPill: { backgroundColor: colors.primaryFill, borderRadius: radius.pill, minWidth: 40, paddingHorizontal: spacing.sm, paddingVertical: 3, alignItems: 'center' },
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.xs },
  whatsNew: { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.sm },
  label: { letterSpacing: 1, marginBottom: 2 },
  change: { flexDirection: 'row', gap: spacing.xs },
  bullet: { width: 12 },
  foot: { marginTop: spacing.md, textAlign: 'center' },
});
