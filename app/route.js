import React, { useMemo, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Linking, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { colors, spacing, radius } from '../src/theme/theme';
import { formatLongDate, nyDateKey } from '../src/utils/dates';

// #5 Garage-sale route planner. Pick the sales you want to hit; we hand the
// ordered addresses to the phone's Maps app, which does the driving directions.
// No in-app routing engine — Maps already does it better, and it works from the
// user's live location.
export default function RouteScreen() {
  const router = useRouter();
  const { garageSales, city, scale } = useApp();
  const [picked, setPicked] = useState([]); // ids, in tap order

  // Upcoming sales for this town, soonest first — the ones worth routing today.
  const sales = useMemo(() => {
    // Eastern-anchored "today" (Hermes-safe). toISOString() would be UTC and,
    // after ~8pm ET, roll to tomorrow — silently dropping same-day sales that are
    // still valid. s.end is a local YYYY-MM-DD, so compare against the ET day key.
    const today = nyDateKey();
    return (garageSales || [])
      .filter((s) => s.address && (!s.end || s.end >= today))
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  }, [garageSales]);

  const toggle = (id) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const byId = useMemo(() => Object.fromEntries(sales.map((s) => [s.id, s])), [sales]);

  const openRoute = () => {
    const stops = picked.map((id) => byId[id]?.address).filter(Boolean);
    if (!stops.length) {
      Alert.alert('Pick a few sales', 'Tap the sales you want to visit, then build your route.');
      return;
    }
    // Google Maps /dir/ path form stacks stops in order and opens the Maps app
    // (or web) on both iOS and Android. "Current+Location" makes it start from GPS.
    const segments = ['Current+Location', ...stops.map((a) => encodeURIComponent(a))];
    const url = `https://www.google.com/maps/dir/${segments.join('/')}`;
    Linking.openURL(url).catch(() =>
      Alert.alert('Could not open Maps', 'Please make sure a maps app is installed.')
    );
  };

  if (!sales.length) {
    return (
      <View style={styles.center}>
        <Ionicons name="map-outline" size={40} color={colors.textMuted} />
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
          No upcoming garage sales in {city?.name || 'your town'} to route yet. Check back, or post one in the app.
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 120 }}>
        <ThemedText size="body" color={colors.textMuted} style={{ marginBottom: spacing.md }}>
          Tap the sales you want to hit (in the order you tap them), then build your route. It opens in your
          Maps app starting from where you are.
        </ThemedText>
        {sales.map((s) => {
          const order = picked.indexOf(s.id);
          const on = order !== -1;
          return (
            <Pressable
              key={s.id}
              style={[styles.row, on && { borderColor: colors.garageSale, backgroundColor: colors.garageSaleLight }]}
              onPress={() => toggle(s.id)}
            >
              <View style={[styles.check, on && { backgroundColor: colors.garageSale, borderColor: colors.garageSale }]}>
                {on ? (
                  <ThemedText size="small" weight="bold" color={colors.textInverse}>{order + 1}</ThemedText>
                ) : null}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <ThemedText size="body" weight="semibold" numberOfLines={1}>{s.title}</ThemedText>
                <ThemedText size="small" color={colors.textMuted} numberOfLines={1}>{s.address}</ThemedText>
                {s.start ? (
                  <ThemedText size="small" color={colors.textMuted} numberOfLines={1}>{formatLongDate(s.start)}</ThemedText>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.footer}>
        <Pressable
          style={[styles.routeBtn, !picked.length && { opacity: 0.5 }]}
          onPress={openRoute}
          disabled={!picked.length}
        >
          <Ionicons name="navigate" size={20} color={colors.textInverse} />
          <ThemedText size="body" weight="bold" color={colors.textInverse}>
            {picked.length ? `Route my ${picked.length} stop${picked.length > 1 ? 's' : ''}` : 'Pick sales to route'}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl, backgroundColor: colors.background },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm,
  },
  check: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: spacing.md, backgroundColor: colors.background,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  routeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.garageSale, borderRadius: radius.pill, paddingVertical: spacing.md, minHeight: 52,
  },
});
