import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { CATEGORIES } from '../src/data/events';
import { colors, spacing, radius, categoryColor } from '../src/theme/theme';

// Maps each category to a recognizable icon for the picker tiles.
const ICONS = {
  Music: 'musical-notes',
  Family: 'happy',
  Food: 'restaurant',
  Sports: 'football',
  Arts: 'color-palette',
  Community: 'people',
  Market: 'storefront',
  Education: 'school',
};

// Pick the categories you care about. Used at onboarding and from Settings.
// In onboarding mode it's the last step before landing in the app.
export default function InterestsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { onboarding } = useLocalSearchParams();
  const { interests, setInterests, completeOnboarding, logEvent } = useApp();
  const [picked, setPicked] = useState(() => new Set(interests));

  const toggle = (cat) => {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const save = () => {
    const list = CATEGORIES.filter((c) => picked.has(c));
    setInterests(list);
    logEvent('set_interests', { count: list.length });
    if (onboarding) {
      completeOnboarding();
      router.replace('/');
    } else {
      router.back();
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: spacing.lg }]}>
      <View style={styles.intro}>
        <ThemedText size="large" weight="bold">What are you into?</ThemedText>
        <ThemedText size="body" color={colors.textMuted} style={{ marginTop: 4 }}>
          Pick a few and we'll surface them first in a "For You" filter. You can change this anytime in Settings.
        </ThemedText>
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        {CATEGORIES.map((cat) => {
          const on = picked.has(cat);
          const accent = categoryColor(cat);
          return (
            <Pressable
              key={cat}
              onPress={() => toggle(cat)}
              style={[styles.tile, on && { borderColor: accent, backgroundColor: accent + '14' }]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={cat}
            >
              <Ionicons name={ICONS[cat] || 'pricetag'} size={26} color={on ? accent : colors.textMuted} />
              <ThemedText size="body" weight={on ? 'bold' : 'regular'} color={on ? accent : colors.text}>
                {cat}
              </ThemedText>
              {on ? <Ionicons name="checkmark-circle" size={18} color={accent} style={styles.check} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable style={styles.primaryBtn} onPress={save}>
          <ThemedText size="subtitle" weight="bold" color={colors.textInverse}>
            {picked.size > 0 ? `Save ${picked.size} ${picked.size === 1 ? 'interest' : 'interests'}` : 'Skip for now'}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  intro: { paddingHorizontal: spacing.md, marginBottom: spacing.md },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  tile: {
    width: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 60,
  },
  check: { marginLeft: 'auto' },
  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
});
