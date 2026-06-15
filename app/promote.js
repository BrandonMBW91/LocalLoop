import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { fetchCityUsers } from '../src/lib/db';
import { rateForUsers } from '../src/data/pricing';
import { colors, spacing, radius } from '../src/theme/theme';

function Benefit({ icon, title, body }) {
  return (
    <View style={styles.benefit}>
      <View style={styles.benefitIcon}>
        <Ionicons name={icon} size={24} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText size="body" weight="bold">{title}</ThemedText>
        <ThemedText size="small" color={colors.textMuted}>{body}</ThemedText>
      </View>
    </View>
  );
}

function RateRow({ label, sub, price, last }) {
  return (
    <View style={[styles.rateRow, !last && styles.rateRowBorder]}>
      <View style={{ flex: 1 }}>
        <ThemedText size="body" weight="semibold">{label}</ThemedText>
        {sub ? <ThemedText size="small" color={colors.textMuted}>{sub}</ThemedText> : null}
      </View>
      <ThemedText size="subtitle" weight="bold" color={colors.primary}>{price}</ThemedText>
    </View>
  );
}

export default function PromoteScreen() {
  const { city, cityId, backendEnabled } = useApp();
  const email = 'michabw91@gmail.com';
  const [users, setUsers] = useState(0);

  useEffect(() => {
    if (backendEnabled) fetchCityUsers(cityId).then(setUsers).catch(() => {});
  }, [cityId, backendEnabled]);

  const rate = rateForUsers(users);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
    >
      <View style={styles.hero}>
        <ThemedText style={{ fontSize: 52 }}>⭐</ThemedText>
        <ThemedText size="large" weight="bold" style={{ textAlign: 'center' }}>
          Reach your neighbors
        </ThemedText>
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
          Put your business in front of people across {city.name} who are looking
          for something to do.
        </ThemedText>
      </View>

      <ThemedText size="subtitle" weight="bold" style={styles.sectionTitle}>
        Feature a listing
      </ThemedText>
      <Benefit
        icon="trending-up"
        title="Rise to the top"
        body="Featured events, sales, and food-truck stops appear above everything else in their list, with a ★ Featured badge."
      />
      <Benefit
        icon="eye"
        title="Get seen first"
        body="Most people only look at what's near the top. Featuring keeps you there."
      />

      <ThemedText size="subtitle" weight="bold" style={styles.sectionTitle}>
        Advertise locally
      </ThemedText>
      <Benefit
        icon="storefront"
        title="Sponsor a spot"
        body="Run a small ad between listings — shown only to people in your town."
      />
      <Benefit
        icon="heart"
        title="Support the community"
        body="Your ad helps keep this app free for everyone in the area."
      />

      <ThemedText size="subtitle" weight="bold" style={styles.sectionTitle}>
        Pricing for {city.name}
      </ThemedText>
      <View style={styles.tierBanner}>
        <Ionicons name="trending-up" size={18} color={colors.primary} />
        <ThemedText size="small" color={colors.text} weight="semibold">
          {rate.name} tier
        </ThemedText>
        <ThemedText size="small" color={colors.textMuted}>
          · {users.toLocaleString()} active {users === 1 ? 'neighbor' : 'neighbors'} this month
        </ThemedText>
      </View>
      <View style={styles.rateCard}>
        <RateRow label="Featured listing" sub="One event, sale, or truck · 7 days" price={`$${rate.featured7}`} />
        <RateRow label="Featured listing" sub="One event, sale, or truck · 30 days" price={`$${rate.featured30}`} />
        <RateRow label="Town sponsor" sub={`Your ad in ${city.name} · monthly`} price={`$${rate.sponsor}/mo`} />
        <RateRow label="All of NW Ohio" sub="Every town · monthly" price="$79/mo" last />
      </View>
      <ThemedText size="small" color={colors.textMuted} style={styles.note}>
        {rate.nextTierAt
          ? `Rates rise as ${city.name} grows — lock in today's rate for a full year. No contracts.`
          : `Founding rates for our first local partners — locked in for a year. No contracts.`}
      </ThemedText>

      <Pressable
        style={styles.cta}
        onPress={() =>
          Linking.openURL(
            `mailto:${email}?subject=Advertising on Local Loop`
          )
        }
      >
        <Ionicons name="mail" size={22} color={colors.textInverse} />
        <ThemedText size="subtitle" weight="bold" color={colors.textInverse}>
          Contact us to advertise
        </ThemedText>
      </Pressable>

      <ThemedText size="small" color={colors.textMuted} style={styles.note}>
        Tap above and we’ll get you set up and send a simple invoice — no in-app
        purchase, no long-term contract.
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.sm },
  benefit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  benefitIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
  },
  rateCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rateRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.lg,
    minHeight: 56,
  },
  note: { textAlign: 'center', marginTop: spacing.md, paddingHorizontal: spacing.md },
});
