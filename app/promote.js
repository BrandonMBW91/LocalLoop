import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { fetchCityUsers } from '../src/lib/db';
import { rateForUsers } from '../src/data/pricing';
import { formatCount } from '../src/utils/dates';
import { REGION_LINK, CHECKOUT_BY_TIER, REGION_ANNUAL_LINK, METRO_LINK, METRO_ANNUAL_LINK, CHECKOUT_ANNUAL_BY_TIER, DEAL_LINK } from '../src/data/checkout';
import { colors, spacing, radius } from '../src/theme/theme';

// Hosted advertise page + live Stripe Payment Links. Purchases stay on the web
// (advertising services are exempt from IAP; no Apple cut). REGION_LINK +
// CHECKOUT_BY_TIER live in src/data/checkout.js — shared with the web advertise
// generator so the links can't drift.
const ADVERTISE_URL = 'https://localloop.io/advertise.html';
// The in-app $9 Local Deal buy button stays hidden until the deal-aware webhook is
// deployed — the live webhook has no product='deal' branch yet, so a purchase would be
// mis-fulfilled as a blank sponsor ad. Flip to true (+ OTA) as the last step of the
// deals deploy, together with the advertise-page deal card (SEO_ITEM_PAGES).
const DEALS_LIVE = true;

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

function RateRow({ label, sub, price, last, url }) {
  const inner = (
    <>
      <View style={{ flex: 1 }}>
        <ThemedText size="body" weight="semibold">{label}</ThemedText>
        {sub ? <ThemedText size="small" color={colors.textMuted}>{sub}</ThemedText> : null}
      </View>
      <ThemedText size="subtitle" weight="bold" color={colors.primary}>{price}</ThemedText>
      {url ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={{ marginLeft: 6 }} /> : null}
    </>
  );
  if (!url) return <View style={[styles.rateRow, !last && styles.rateRowBorder]}>{inner}</View>;
  return (
    <Pressable
      style={({ pressed }) => [styles.rateRow, !last && styles.rateRowBorder, pressed && { opacity: 0.6 }]}
      onPress={() => Linking.openURL(url)}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${price}, opens secure checkout`}
    >
      {inner}
    </Pressable>
  );
}

export default function PromoteScreen() {
  const { city, cityId, backendEnabled } = useApp();
  const email = 'localloop@localloop.io';
  // null = user count UNKNOWN (loading, or the RPC failed). Never price off an
  // unknown count — rateForUsers(0) = Founding $19 would let a Local-tier ($29)
  // town check out at the wrong price during any network blip.
  const [users, setUsers] = useState(null);
  const [totalUsers, setTotalUsers] = useState(0);

  useEffect(() => {
    setUsers(null); // switching towns resets to unknown
    if (backendEnabled) {
      fetchCityUsers(cityId).then(setUsers).catch(() => {}); // resolves null on failure
      fetchCityUsers(null).then((n) => setTotalUsers(n || 0)).catch(() => {}); // display only
    }
  }, [cityId, backendEnabled]);

  const known = users != null;
  const rate = rateForUsers(users || 0);
  // Tap-to-buy only when the tier is KNOWN and has live links; an unknown count
  // shows the email flow instead of possibly-wrong Founding buy links.
  const links = known ? CHECKOUT_BY_TIER[rate.name] || null : null;
  const buyable = !!links;
  const annualTown = known ? CHECKOUT_ANNUAL_BY_TIER[rate.name]?.town : null;

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
        body="Run a small ad between listings, shown only to people in your town."
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
          {known ? `${rate.name} tier` : 'Checking your town…'}
        </ThemedText>
        <ThemedText size="small" color={colors.textMuted}>
          {known
            ? `· ${formatCount(users)} active ${users === 1 ? 'neighbor' : 'neighbors'} in ${city.name}${totalUsers > users ? ` · ${formatCount(totalUsers)} across all towns` : ''} this month`
            : `· current rate loads in a moment`}
        </ThemedText>
      </View>
      <View style={styles.rateCard}>
        <RateRow label="Featured listing" sub="One event, sale, or truck · 7 days · email us" price={known ? `$${rate.featured7}` : '$…'} />
        <RateRow label="Featured listing" sub={`One event, sale, or truck · 30 days${links ? ' · tap to buy' : ' · email us'}`} price={known ? `$${rate.featured30}` : '$…'} url={links ? links.featured30 : undefined} />
        {DEALS_LIVE ? <RateRow label="Local Deal" sub="Your coupon or special in your town's Deals list · monthly · tap to buy" price="$9/mo" url={DEAL_LINK} /> : null}
        <RateRow label="Town sponsor" sub={`Your ad in ${city.name} · monthly${links ? ' · tap to buy' : ' · email us'}`} price={known ? `$${rate.sponsor}/mo` : '$…'} url={links ? links.town : undefined} />
        <RateRow label="Metro sponsor" sub="A whole metro (Toledo, Akron, Canton, and more) · monthly · tap to buy" price="$39/mo" url={METRO_LINK} />
        <RateRow label="All towns" sub="Every town we cover · monthly · tap to buy" price="$79/mo" url={REGION_LINK} />
        {annualTown ? <RateRow label="Town · yearly" sub="Your town · pay yearly, save 2 months · tap to buy" price="$190/yr" url={annualTown} /> : null}
        <RateRow label="Metro · yearly" sub="A whole metro · save 2 months · tap to buy" price="$390/yr" url={METRO_ANNUAL_LINK} />
        <RateRow label="All towns · yearly" sub="Every town · save 2 months · tap to buy" price="$790/yr" url={REGION_ANNUAL_LINK} />
        <RateRow label="Custom plan" sub="Multiple towns, events, nonprofits" price="Let's talk" last />
      </View>
      <ThemedText size="small" color={colors.textMuted} style={styles.note}>
        {rate.nextTierAt
          ? `You pay the ${rate.name} rate shown above. Rates step up as ${city.name} grows, so start now to lock in today's price for a full year. No contracts.`
          : `You pay the ${rate.name} rate shown above, locked in for a full year. No contracts.`}
      </ThemedText>

      {buyable ? (
        <Pressable style={styles.cta} onPress={() => Linking.openURL(links.town)}>
          <Ionicons name="card" size={22} color={colors.textInverse} />
          <ThemedText size="subtitle" weight="bold" color={colors.textInverse}>
            Become a Town Sponsor · ${rate.sponsor}/mo
          </ThemedText>
        </Pressable>
      ) : null}

      <Pressable
        style={ADVERTISE_URL ? styles.ctaOutline : styles.cta}
        onPress={() =>
          Linking.openURL(`mailto:${email}?subject=Advertising on Local Loop`)
        }
      >
        <Ionicons name="mail" size={22} color={ADVERTISE_URL ? colors.accent : colors.textInverse} />
        <ThemedText size="subtitle" weight="bold" color={ADVERTISE_URL ? colors.accent : colors.textInverse}>
          {ADVERTISE_URL ? 'Questions? Email us' : 'Contact us to advertise'}
        </ThemedText>
      </Pressable>

      <ThemedText size="small" color={colors.textMuted} style={styles.note}>
        Tap above and we’ll get you set up and send a simple invoice. No in-app
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
  ctaOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    minHeight: 52,
  },
  note: { textAlign: 'center', marginTop: spacing.md, paddingHorizontal: spacing.md },
});
