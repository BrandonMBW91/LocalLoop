import React from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { colors, spacing, radius } from '../src/theme/theme';

const RULES = [
  {
    icon: 'home',
    title: 'Garage sales are SALES, not single items',
    body:
      'The Garage Sales section is for actual yard, garage, estate, or moving sales — a real event where you’re selling lots of things. It is NOT for listing one item for sale (like a single couch or TV). Single-item posts will be removed.',
  },
  {
    icon: 'location',
    title: 'Real, local listings only',
    body: 'Post genuine events, sales, and food trucks happening in your community — no advertisements, spam, or links to other sites.',
  },
  {
    icon: 'happy',
    title: 'Keep it friendly',
    body: 'Family-appropriate and respectful. No offensive language, harassment, or anything illegal.',
  },
  {
    icon: 'checkmark-circle',
    title: 'Be accurate',
    body: 'Use real dates, times, and addresses so neighbors can actually find your event.',
  },
  {
    icon: 'shield-checkmark',
    title: 'Posts are reviewed',
    body: 'You’re responsible for what you post. We review submissions and may remove anything that breaks these rules.',
  },
];

export default function RulesScreen() {
  const router = useRouter();
  const { next } = useLocalSearchParams();
  const { acceptRules } = useApp();

  const onAgree = () => {
    acceptRules();
    if (typeof next === 'string' && next) router.replace(next);
    else router.back();
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.lg }}>
        <View style={styles.intro}>
          <ThemedText style={{ fontSize: 44, textAlign: 'center' }}>🤝</ThemedText>
          <ThemedText size="title" weight="bold" style={{ textAlign: 'center' }}>
            A few community rules
          </ThemedText>
          <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
            Please read these before you post. They keep things useful and friendly
            for everyone.
          </ThemedText>
        </View>

        {RULES.map((r, i) => (
          <View key={i} style={[styles.rule, i === 0 && styles.ruleHighlight]}>
            <View style={[styles.ruleIcon, i === 0 && { backgroundColor: colors.garageSale }]}>
              <Ionicons name={r.icon} size={22} color={colors.textInverse} />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText size="body" weight="bold">{r.title}</ThemedText>
              <ThemedText size="small" color={colors.textMuted} style={{ marginTop: 2 }}>
                {r.body}
              </ThemedText>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.agreeBtn} onPress={onAgree} accessibilityRole="button">
          <Ionicons name="checkmark" size={22} color={colors.textInverse} />
          <ThemedText size="subtitle" weight="bold" color={colors.textInverse}>
            I Agree — Continue
          </ThemedText>
        </Pressable>
        <Pressable style={styles.cancelBtn} onPress={() => router.back()}>
          <ThemedText size="body" color={colors.textMuted}>Not now</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  intro: { gap: 6, marginBottom: spacing.lg, marginTop: spacing.sm },
  rule: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  ruleHighlight: { borderColor: colors.garageSale, borderWidth: 2 },
  ruleIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  agreeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    minHeight: 56,
  },
  cancelBtn: { alignItems: 'center', paddingVertical: spacing.sm, minHeight: 40 },
});
