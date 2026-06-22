import React, { useEffect, useRef, useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import { colors, spacing, radius } from '../theme/theme';

// Bias suggestions toward Findlay, OH.
const FINDLAY = { lat: 41.0442, lon: -83.6499 };

// Mapbox public token — read from the env (EXPO_PUBLIC_* is inlined into the
// build). Set EXPO_PUBLIC_MAPBOX_TOKEN in .env.
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

async function fetchSuggestions(text) {
  if (!MAPBOX_TOKEN) return [];
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(text)}.json` +
    `?access_token=${MAPBOX_TOKEN}&country=US&autocomplete=true&limit=5` +
    `&proximity=${FINDLAY.lon},${FINDLAY.lat}&types=address,poi,place`;
  const res = await fetch(url);
  const json = await res.json();
  return (json.features || [])
    .map((f) => (f.place_name || '').replace(/, United States$/, ''))
    .filter(Boolean);
}

export default function AddressAutocomplete({
  value,
  onChangeText,
  placeholder,
  accent = colors.primary,
  fontSize,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);
  const seqRef = useRef(0);
  const mounted = useRef(true);

  // Cancel any pending lookup if this field unmounts mid-debounce, and flag the
  // unmount so an in-flight fetch that resolves later can't setState.
  useEffect(() => () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); }, []);

  const onType = (text) => {
    onChangeText(text);
    if (timer.current) clearTimeout(timer.current);
    if (!text || text.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    timer.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      try {
        setLoading(true);
        const results = await fetchSuggestions(text);
        if (!mounted.current || seq !== seqRef.current) return; // unmounted or a newer keystroke won
        setSuggestions(results);
      } catch (e) {
        if (mounted.current && seq === seqRef.current) setSuggestions([]);
      } finally {
        if (mounted.current && seq === seqRef.current) setLoading(false);
      }
    }, 350);
  };

  const pick = (addr) => {
    onChangeText(addr);
    setSuggestions([]);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.inputWrap}>
        <Ionicons name="location-outline" size={20} color={accent} />
        <TextInput
          value={value}
          onChangeText={onType}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, fontSize ? { fontSize } : null]}
          autoCorrect={false}
        />
        {loading ? <ActivityIndicator size="small" color={accent} /> : null}
      </View>

      {suggestions.length > 0 && (
        <View style={styles.dropdown}>
          {suggestions.map((s, i) => (
            <Pressable
              key={`${s}-${i}`}
              onPress={() => pick(s)}
              style={[styles.item, i > 0 && styles.itemBorder]}
              accessibilityRole="button"
            >
              <Ionicons name="location" size={16} color={colors.textMuted} />
              <ThemedText size="small" style={{ flex: 1 }} numberOfLines={2}>
                {s}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    zIndex: 20,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 52,
  },
  input: {
    flex: 1,
    color: colors.text,
    paddingVertical: 14,
    fontSize: 18,
  },
  dropdown: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 30,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  itemBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
