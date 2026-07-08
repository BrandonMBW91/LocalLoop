import React, { useEffect, useState, useCallback } from 'react';
import {
  View, ScrollView, StyleSheet, Pressable, TextInput, RefreshControl,
  ActivityIndicator, Alert, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { CITIES } from '../src/data/cities';
import { fetchAllDeals, insertDeal, setDealActive, deleteDeal } from '../src/lib/db';
import { colors, spacing, radius, baseFont } from '../src/theme/theme';
import { formatDateMedium } from '../src/utils/dates';

const RUN_OPTIONS = [
  { label: '2 weeks', weeks: 2 },
  { label: '1 month', weeks: 4 },
  { label: '3 months', weeks: 13 },
  { label: 'No end', weeks: 0 },
];

function Field({ label, ...props }) {
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <ThemedText size="small" weight="semibold" color={colors.textMuted} style={{ marginBottom: 4 }}>
        {label}
      </ThemedText>
      <TextInput style={styles.input} placeholderTextColor={colors.textMuted} {...props} />
    </View>
  );
}

export default function ManageDealsScreen() {
  const { isAdmin, cityId, refresh } = useApp();
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [formCity, setFormCity] = useState(cityId);
  const [business, setBusiness] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [runWeeks, setRunWeeks] = useState(4);
  const [featured, setFeatured] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDeals(await fetchAllDeals());
    } catch (e) {
      Alert.alert('Could not load', e?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const create = async () => {
    if (!business.trim() || !title.trim()) {
      Alert.alert('Add the basics', 'A business name and a deal headline are required.');
      return;
    }
    setSaving(true);
    try {
      const endsAt = runWeeks > 0 ? new Date(Date.now() + runWeeks * 7 * 86400000).toISOString() : null;
      const created = await insertDeal({
        cityId: formCity,
        businessName: business.trim(),
        title: title.trim(),
        description: description.trim(),
        linkUrl: linkUrl.trim(),
        featured,
        endsAt,
        active: true,
      });
      setDeals((prev) => [created, ...prev]);
      setBusiness(''); setTitle(''); setDescription(''); setLinkUrl(''); setFeatured(false);
      refresh();
    } catch (e) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (deal) => {
    const next = !deal.active;
    setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, active: next } : d)));
    try {
      await setDealActive(deal.id, next);
      refresh();
    } catch (e) {
      setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, active: deal.active } : d)));
      Alert.alert('Could not update', e?.message || 'Please try again.');
    }
  };

  const remove = (deal) => {
    Alert.alert('Delete this deal?', `“${deal.title}” will be removed permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await deleteDeal(deal.id);
            setDeals((prev) => prev.filter((d) => d.id !== deal.id));
            refresh();
          } catch (e) {
            Alert.alert('Could not delete', e?.message || 'Please try again.');
          }
        },
      },
    ]);
  };

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed" size={40} color={colors.textMuted} />
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
          This area is for moderators. Sign in with your admin account to manage deals.
        </ThemedText>
      </View>
    );
  }

  const cityName = (id) => CITIES.find((c) => c.id === id)?.name || id;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
      keyboardShouldPersistTaps="handled"
    >
      <ThemedText size="subtitle" weight="bold" style={{ marginBottom: spacing.sm }}>New deal</ThemedText>
      <View style={styles.card}>
        <ThemedText size="small" weight="semibold" color={colors.textMuted} style={{ marginBottom: 4 }}>City</ThemedText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {CITIES.map((c) => {
              const sel = c.id === formCity;
              return (
                <Pressable key={c.id} onPress={() => setFormCity(c.id)} style={[styles.chip, sel && styles.chipSel]}>
                  <ThemedText size="small" weight={sel ? 'bold' : 'regular'} color={sel ? colors.textInverse : colors.text}>
                    {c.name}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <Field label="Business name" value={business} onChangeText={setBusiness} placeholder="Joe's Pizza" autoCapitalize="words" />
        <Field label="Deal headline" value={title} onChangeText={setTitle} placeholder="2-for-1 pizzas every Tuesday" autoCapitalize="sentences" />
        <Field label="Details (optional)" value={description} onChangeText={setDescription} placeholder="Dine-in only. Through the end of summer." autoCapitalize="sentences" />
        <Field label="Website or phone link (optional)" value={linkUrl} onChangeText={setLinkUrl} placeholder="https://… or tel:4195551234" autoCapitalize="none" keyboardType="url" />

        <ThemedText size="small" weight="semibold" color={colors.textMuted} style={{ marginBottom: 4 }}>Run length</ThemedText>
        <View style={styles.runRow}>
          {RUN_OPTIONS.map((o) => {
            const sel = o.weeks === runWeeks;
            return (
              <Pressable key={o.label} onPress={() => setRunWeeks(o.weeks)} style={[styles.chip, sel && styles.chipSel]}>
                <ThemedText size="small" weight={sel ? 'bold' : 'regular'} color={sel ? colors.textInverse : colors.text}>{o.label}</ThemedText>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.featuredToggle}>
          <ThemedText size="body">Feature this deal (top of the list)</ThemedText>
          <Switch value={featured} onValueChange={setFeatured} />
        </View>

        <Pressable style={[styles.createBtn, saving && { opacity: 0.6 }]} onPress={create} disabled={saving}>
          {saving ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <>
              <Ionicons name="add-circle" size={22} color={colors.textInverse} />
              <ThemedText size="body" weight="bold" color={colors.textInverse}>Create deal</ThemedText>
            </>
          )}
        </Pressable>
      </View>

      <ThemedText size="subtitle" weight="bold" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
        All deals ({deals.length})
      </ThemedText>

      {loading && deals.length === 0 ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : deals.length === 0 ? (
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center', paddingVertical: spacing.lg }}>
          No deals yet. Create one above and it appears in that town.
        </ThemedText>
      ) : (
        deals.map((deal) => {
          const ends = deal.endsAt ? new Date(deal.endsAt) : null;
          return (
            <View key={deal.id} style={styles.dealCard}>
              <View style={{ flex: 1 }}>
                <View style={styles.dealTop}>
                  <ThemedText size="body" weight="bold" numberOfLines={1} style={{ flex: 1 }}>{deal.title}</ThemedText>
                  <Switch value={deal.active} onValueChange={() => toggle(deal)} />
                </View>
                <ThemedText size="tiny" color={colors.textMuted}>
                  {deal.businessName} · {cityName(deal.cityId)}
                  {ends ? ` · ends ${formatDateMedium(ends)}` : ' · no end date'}
                  {deal.active ? '' : ' · paused'}
                  {deal.featured ? ' · ★ featured' : ''}
                </ThemedText>
                <View style={styles.statsRow}>
                  <Ionicons name="eye-outline" size={15} color={colors.primary} />
                  <ThemedText size="small" weight="semibold">{deal.viewCount} taps</ThemedText>
                </View>
                <Pressable onPress={() => remove(deal)} hitSlop={8} style={styles.deleteLink}>
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  <ThemedText size="small" weight="semibold" color={colors.danger}>Delete</ThemedText>
                </Pressable>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.xxl },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: baseFont.body,
    color: colors.text, backgroundColor: colors.background, minHeight: 48,
  },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, minHeight: 40, justifyContent: 'center',
  },
  chipSel: { backgroundColor: colors.primary, borderColor: colors.primary },
  runRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  featuredToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: spacing.md, minHeight: 52, marginTop: spacing.sm,
  },
  dealCard: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  dealTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  deleteLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
});
