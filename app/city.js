import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { CITIES, REGION_ORDER } from '../src/data/cities';
import { nearMeAvailable, suggestTownFromLocation } from '../src/lib/nearMe';
import { formatCount } from '../src/utils/dates';
import { colors, spacing, radius, baseFont } from '../src/theme/theme';

const CITY_NAME_SET = new Set(CITIES.map((c) => c.id));

export default function CityPickerScreen() {
  const router = useRouter();
  const { onboarding } = useLocalSearchParams();
  const { cityId, setCity, scale, activeCityIds, cityCounts } = useApp();
  const [query, setQuery] = useState('');

  // Show only towns the aggregator currently has events for (plus the user's own
  // selection, so it's never hidden). Until the active set loads — or if the fetch
  // fails / there's no backend — show every town as a safe fallback.
  const visible = useMemo(() => {
    if (!activeCityIds) return CITIES;
    return CITIES.filter((c) => activeCityIds.has(c.id) || c.id === cityId);
  }, [activeCityIds, cityId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visible;
    // Search the FULL catalog, not just visible towns: someone in a
    // supported-but-quiet town who types its name must be able to pick it —
    // "No town by that name yet" would be flatly wrong for them.
    return CITIES.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.tagline || '').toLowerCase().includes(q)
    );
  }, [query, visible]);

  // Group the (filtered) towns by region, alphabetized within each section,
  // keeping REGION_ORDER and dropping any empty section (e.g. while searching).
  const sections = useMemo(
    () =>
      REGION_ORDER.map((region) => ({
        region,
        items: filtered
          .filter((c) => (c.region || REGION_ORDER[0]) === region)
          .sort((a, b) => a.name.localeCompare(b.name)),
      })).filter((s) => s.items.length > 0),
    [filtered]
  );

  const choose = (id) => {
    setCity(id);
    if (onboarding) {
      // Came from the first-launch welcome — one more step (interests) then land
      // in the app. The interests screen finishes onboarding when done/skipped.
      router.replace({ pathname: '/interests', params: { onboarding: '1' } });
    } else {
      router.back();
    }
  };

  // #2 Near me — one tap picks the closest served town from GPS. Only shown when
  // the native location module is present (new binary); OTA on an older binary
  // simply hides it. Non-blocking: denial/no-fix just leaves the list.
  const [locating, setLocating] = useState(false);
  const useMyLocation = async () => {
    setLocating(true);
    try {
      const hit = await suggestTownFromLocation();
      if (hit && CITY_NAME_SET.has(hit.cityId)) {
        choose(hit.cityId);
      } else {
        Alert.alert(
          "Couldn't find a nearby town",
          hit ? 'You seem to be outside our Ohio towns for now.' : 'Turn on location for Local Loop, or pick your town from the list.'
        );
      }
    } finally {
      setLocating(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={22} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your town…"
          placeholderTextColor={colors.textMuted}
          style={[styles.searchInput, { fontSize: Math.round(baseFont.body * scale) }]}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search for a city"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={22} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {nearMeAvailable() && !query ? (
        <Pressable style={({ pressed }) => [styles.nearMe, pressed && { opacity: 0.6 }]} onPress={useMyLocation} disabled={locating}>
          <Ionicons name="location" size={20} color={colors.primary} />
          <ThemedText size="body" weight="bold" color={colors.primary}>
            {locating ? 'Finding your town…' : 'Use my location'}
          </ThemedText>
        </Pressable>
      ) : null}

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        {sections.map((section) => (
          <View key={section.region}>
            <View style={styles.regionBanner}>
              <ThemedText size="subtitle" weight="bold" color={colors.textInverse}>
                {section.region}
              </ThemedText>
              <ThemedText size="small" color={colors.textInverse} style={{ opacity: 0.9 }}>
                {section.items.length} town{section.items.length === 1 ? '' : 's'}
              </ThemedText>
            </View>
            {section.items.map((c, i) => {
              const selected = c.id === cityId;
              // Density-aware label: a real count once a town has enough, else a
              // friendly "just getting started" so a tiny number never discourages.
              const n = cityCounts ? cityCounts[c.id] : undefined;
              const countLabel = n == null ? null : n >= 25 ? `${formatCount(n)} events` : 'Just getting started';
              return (
                <Pressable
                  key={c.id}
                  onPress={() => choose(c.id)}
                  style={({ pressed }) => [styles.row, i > 0 && styles.rowBorder, selected && styles.rowSelected, pressed && { opacity: 0.6 }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <View style={{ flex: 1 }}>
                    <ThemedText size="body" weight={selected ? 'bold' : 'regular'}>
                      {c.name}, {c.state}
                    </ThemedText>
                    {countLabel ? (
                      <ThemedText size="small" color={colors.textMuted}>
                        {countLabel}
                      </ThemedText>
                    ) : c.tagline ? (
                      <ThemedText size="small" color={colors.textMuted}>
                        {c.tagline}
                      </ThemedText>
                    ) : null}
                  </View>
                  <Ionicons
                    name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={26}
                    color={selected ? colors.primary : colors.textMuted}
                  />
                </Pressable>
              );
            })}
          </View>
        ))}

        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <ThemedText style={{ fontSize: 40 }}>🔍</ThemedText>
            <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
              No town by that name yet. More are added as the app grows. Tell us which one
              you’d like!
            </ThemedText>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  nearMe: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginHorizontal: spacing.md, marginBottom: spacing.sm,
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.pill,
    paddingVertical: spacing.sm, minHeight: 46,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    margin: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 52,
  },
  searchInput: { flex: 1, color: colors.text, paddingVertical: 12 },
  regionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primaryFill,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 60,
    backgroundColor: colors.surface,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowSelected: { backgroundColor: colors.primaryLight },
  empty: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
});
