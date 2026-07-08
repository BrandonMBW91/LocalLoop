import React from 'react';
import { View, StyleSheet, Pressable, Image, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import Pill from './Pill';
import { useApp } from '../context/AppContext';
import { recordDealView } from '../lib/db';
import { formatDateMedium } from '../utils/dates';
import { colors, spacing, radius } from '../theme/theme';

export default function DealCard({ deal }) {
  const { backendEnabled, scale } = useApp();
  const accent = colors.accent;
  const isTel = (deal.linkUrl || '').startsWith('tel:');
  const ends = deal.endsAt ? new Date(deal.endsAt) : null;
  const thumb = Math.round(60 * Math.min(scale, 1.2));

  const open = () => {
    if (backendEnabled && deal.id) recordDealView(deal.id);
    if (deal.linkUrl) Linking.openURL(deal.linkUrl).catch(() => {});
  };

  return (
    <View style={[styles.card, deal.featured && styles.cardFeatured]}>
      <View style={styles.row}>
        {deal.imageUrl ? (
          <Image source={{ uri: deal.imageUrl }} style={[styles.thumb, { width: thumb, height: thumb }]} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbIcon, { width: thumb, height: thumb }]}>
            <Ionicons name="pricetag" size={26} color={accent} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={styles.topRow}>
            <ThemedText size="tiny" weight="bold" color={accent}>
              {(deal.businessName || 'Local business').toUpperCase()}
            </ThemedText>
            {deal.featured ? (
              <Pill label="FEATURED" color={colors.accent} bg={colors.accentLight} icon="star" />
            ) : null}
          </View>
          <ThemedText size="subtitle" weight="bold" numberOfLines={2}>
            {deal.title}
          </ThemedText>
          {deal.description ? (
            <ThemedText size="small" color={colors.textMuted} numberOfLines={2} style={{ marginTop: spacing.xxs }}>
              {deal.description}
            </ThemedText>
          ) : null}
        </View>
      </View>

      <View style={styles.footer}>
        {ends ? (
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={15} color={colors.textMuted} />
            <ThemedText size="small" color={colors.textMuted}>
              Valid until {formatDateMedium(ends)}
            </ThemedText>
          </View>
        ) : (
          <View />
        )}
        {deal.linkUrl ? (
          <Pressable style={styles.btn} onPress={open}>
            <Ionicons name={isTel ? 'call' : 'open-outline'} size={18} color={colors.textInverse} />
            <ThemedText size="small" weight="bold" color={colors.textInverse}>
              {isTel ? 'Call' : 'Visit'}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    shadowColor: colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardFeatured: { borderColor: colors.accent, backgroundColor: colors.accentLight + '66' },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  thumb: { borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  thumbIcon: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentLight },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: spacing.xxs },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 40,
  },
});
