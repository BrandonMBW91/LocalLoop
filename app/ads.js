import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from '../src/components/ThemedText';
import { formatDateMedium } from '../src/utils/dates';
import { useApp } from '../src/context/AppContext';
import { CITIES } from '../src/data/cities';
import {
  fetchAllSponsors,
  insertSponsor,
  setSponsorActive,
  deleteSponsor,
  expirePromotions,
} from '../src/lib/db';
import { colors, spacing, radius, baseFont } from '../src/theme/theme';

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
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        {...props}
      />
    </View>
  );
}

export default function AdsScreen() {
  const { isAdmin, cityId, refresh } = useApp();
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // New-ad form state
  const [formCity, setFormCity] = useState(cityId);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [runWeeks, setRunWeeks] = useState(4);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await expirePromotions();
      setAds(await fetchAllSponsors());
    } catch (e) {
      Alert.alert('Could not load', e?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const resetForm = () => {
    setTitle('');
    setBody('');
    setLinkUrl('');
    setImageUrl('');
  };

  const create = async () => {
    if (!title.trim()) {
      Alert.alert('Add a title', 'Give the ad a short business name or headline.');
      return;
    }
    setSaving(true);
    try {
      const endsAt = runWeeks > 0 ? new Date(Date.now() + runWeeks * 7 * 86400000).toISOString() : null;
      const created = await insertSponsor({
        cityId: formCity,
        title: title.trim(),
        body: body.trim(),
        linkUrl: linkUrl.trim(),
        imageUrl: imageUrl.trim(),
        endsAt,
        active: true,
      });
      setAds((prev) => [created, ...prev]);
      resetForm();
      refresh(); // reload the live ad list the rest of the app shows
    } catch (e) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (ad) => {
    const next = !ad.active;
    setAds((prev) => prev.map((a) => (a.id === ad.id ? { ...a, active: next } : a)));
    try {
      await setSponsorActive(ad.id, next);
      refresh();
    } catch (e) {
      setAds((prev) => prev.map((a) => (a.id === ad.id ? { ...a, active: ad.active } : a)));
      Alert.alert('Could not update', e?.message || 'Please try again.');
    }
  };

  const remove = (ad) => {
    Alert.alert('Delete this ad?', `“${ad.title}” will be removed permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteSponsor(ad.id);
            setAds((prev) => prev.filter((a) => a.id !== ad.id));
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
          This area is for moderators. Sign in with your admin account to manage ads.
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
      {/* New ad form */}
      <ThemedText size="subtitle" weight="bold" style={{ marginBottom: spacing.sm }}>
        New sponsor
      </ThemedText>
      <View style={styles.card}>
        <ThemedText size="small" weight="semibold" color={colors.textMuted} style={{ marginBottom: 4 }}>
          City
        </ThemedText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {CITIES.map((c) => {
              const sel = c.id === formCity;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setFormCity(c.id)}
                  style={[styles.chip, sel && styles.chipSel]}
                >
                  <ThemedText size="small" weight={sel ? 'bold' : 'regular'} color={sel ? colors.textInverse : colors.text}>
                    {c.name}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <Field label="Business name / headline" value={title} onChangeText={setTitle} placeholder="Joe's Pizza — 2 for 1 Tuesdays" autoCapitalize="sentences" />
        <Field label="Short description (optional)" value={body} onChangeText={setBody} placeholder="Downtown Findlay's favorite slice" autoCapitalize="sentences" />
        <Field label="Link when tapped (optional)" value={linkUrl} onChangeText={setLinkUrl} placeholder="https://joespizza.com" keyboardType="url" />
        <Field label="Image URL (optional)" value={imageUrl} onChangeText={setImageUrl} placeholder="https://…/logo.jpg" keyboardType="url" />

        <ThemedText size="small" weight="semibold" color={colors.textMuted} style={{ marginBottom: 4 }}>
          Run length
        </ThemedText>
        <View style={styles.runRow}>
          {RUN_OPTIONS.map((o) => {
            const sel = o.weeks === runWeeks;
            return (
              <Pressable key={o.label} onPress={() => setRunWeeks(o.weeks)} style={[styles.chip, sel && styles.chipSel]}>
                <ThemedText size="small" weight={sel ? 'bold' : 'regular'} color={sel ? colors.textInverse : colors.text}>
                  {o.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <Pressable style={[styles.createBtn, saving && { opacity: 0.6 }]} onPress={create} disabled={saving}>
          {saving ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <>
              <Ionicons name="add-circle" size={22} color={colors.textInverse} />
              <ThemedText size="body" weight="bold" color={colors.textInverse}>Create sponsor</ThemedText>
            </>
          )}
        </Pressable>
      </View>

      {/* Existing ads */}
      <ThemedText size="subtitle" weight="bold" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
        All sponsors ({ads.length})
      </ThemedText>

      {loading && ads.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : ads.length === 0 ? (
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center', paddingVertical: spacing.lg }}>
          No sponsors yet. Create one above and it appears between listings in that city.
        </ThemedText>
      ) : (
        ads.map((ad) => {
          const ends = ad.endsAt ? new Date(ad.endsAt) : null;
          const expired = ends && ends.getTime() < Date.now();
          return (
            <View key={ad.id} style={styles.adCard}>
              <View style={{ flex: 1 }}>
                <View style={styles.adTop}>
                  <ThemedText size="body" weight="bold" numberOfLines={1} style={{ flex: 1 }}>
                    {ad.title}
                  </ThemedText>
                  <Switch value={ad.active} onValueChange={() => toggle(ad)} />
                </View>
                <ThemedText size="tiny" color={colors.textMuted}>
                  {cityName(ad.cityId)}
                  {ends ? ` · ${expired ? 'ended' : 'ends'} ${formatDateMedium(ends)}` : ' · no end date'}
                  {ad.active ? '' : ' · paused'}
                </ThemedText>
                <View style={styles.statsRow}>
                  <Ionicons name="eye-outline" size={15} color={colors.primary} />
                  <ThemedText size="small" weight="semibold">{ad.impressions} views</ThemedText>
                  <Ionicons name="open-outline" size={15} color={colors.primary} style={{ marginLeft: spacing.md }} />
                  <ThemedText size="small" weight="semibold">{ad.clicks} taps</ThemedText>
                  {ad.impressions > 0 ? (
                    <ThemedText size="small" color={colors.textMuted} style={{ marginLeft: spacing.md }}>
                      {Math.round((ad.clicks / ad.impressions) * 100)}% CTR
                    </ThemedText>
                  ) : null}
                </View>
                {ad.body ? (
                  <ThemedText size="small" color={colors.textMuted} numberOfLines={2} style={{ marginTop: 2 }}>
                    {ad.body}
                  </ThemedText>
                ) : null}
                <Pressable onPress={() => remove(ad)} hitSlop={8} style={styles.deleteLink}>
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
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: baseFont.body,
    color: colors.text,
    backgroundColor: colors.background,
    minHeight: 48,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 40,
    justifyContent: 'center',
  },
  chipSel: { backgroundColor: colors.primary, borderColor: colors.primary },
  runRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    minHeight: 52,
    marginTop: spacing.sm,
  },
  adCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  adTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, flexWrap: 'wrap' },
  deleteLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
});
