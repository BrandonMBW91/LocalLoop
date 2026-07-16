import React from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ThemedText from '../../src/components/ThemedText';
import { useApp } from '../../src/context/AppContext';
import { colors, spacing, radius, textOn } from '../../src/theme/theme';

function ChoiceCard({ icon, accent, title, subtitle, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.choice, { borderColor: accent }, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {/* `accent` is also the border and the chevron, where the light brand hue is
          correct, so it cannot be swapped for a *Fill token just to carry this icon. */}
      <View style={[styles.choiceIcon, { backgroundColor: accent }]}>
        <Ionicons name={icon} size={34} color={textOn(accent)} />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText size="title" weight="bold">{title}</ThemedText>
        <ThemedText size="body" color={colors.textMuted}>{subtitle}</ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={26} color={accent} />
    </Pressable>
  );
}

export default function PostScreen() {
  const router = useRouter();
  const { city, backendEnabled, signedIn } = useApp();

  // When a backend is configured, you must be signed in to post. Browsing is
  // always open. (With no backend, posting works locally for the prototype.)
  const go = (path) => {
    if (backendEnabled && !signedIn) {
      router.push({ pathname: '/sign-in', params: { next: path } });
    } else {
      router.push(path);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
    >
      <View style={styles.intro}>
        <ThemedText size="large" weight="bold">What would you like to post?</ThemedText>
        <ThemedText size="body" color={colors.textMuted}>
          Share it with your neighbors in {city.name}. It’s always free.
        </ThemedText>
      </View>

      <ChoiceCard
        icon="calendar"
        accent={colors.primary}
        title="Post an Event"
        subtitle="Concerts, markets, classes, meetups, fundraisers, and more"
        onPress={() => go('/event/new')}
      />

      <ChoiceCard
        icon="pricetags"
        accent={colors.garageSale}
        title="Post a Garage Sale"
        subtitle="Garage, yard, estate, and moving sales"
        onPress={() => go('/garage-sale/new')}
      />

      <ChoiceCard
        icon="fast-food"
        accent={colors.foodTruck}
        title="Post a Food Truck"
        subtitle="Tell people where you’ll be parked and when"
        onPress={() => go('/food-truck/new')}
      />

      <View style={styles.note}>
        <Ionicons name="shield-checkmark" size={20} color={colors.success} />
        <ThemedText size="small" color={colors.textMuted} style={{ flex: 1 }}>
          Everything you post is reviewed before it appears, to keep {city.name}{' '}
          friendly and trustworthy.
        </ThemedText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  intro: { marginBottom: spacing.lg, gap: 6, marginTop: spacing.sm },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  choiceIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
});
