import React, { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ThemedText from '../../src/components/ThemedText';
import DateTimeField from '../../src/components/DateTimeField';
import AddressAutocomplete from '../../src/components/AddressAutocomplete';
import { useApp } from '../../src/context/AppContext';
import { CATEGORIES } from '../../src/data/events';
import { CITIES } from '../../src/data/cities';
import { insertEvent } from '../../src/lib/db';
import { colors, spacing, radius, baseFont, categoryColor } from '../../src/theme/theme';

const EMOJI_BY_CAT = {
  Music: '🎶', Family: '👨‍👩‍👧', Food: '🍽️', Sports: '🏅',
  Arts: '🎨', Community: '🤝', Market: '🛍️', Education: '📚',
};

const REPEATS = [
  { key: 'once', label: 'Just once' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'daily', label: 'Daily' },
];

function Field({ label, hint, children, required }) {
  return (
    <View style={styles.field}>
      <ThemedText size="body" weight="semibold">
        {label}
        {required ? <ThemedText size="small" weight="semibold" color={colors.danger}> (required)</ThemedText> : null}
      </ThemedText>
      {hint ? (
        <ThemedText size="small" color={colors.textMuted} style={{ marginBottom: 4 }}>
          {hint}
        </ThemedText>
      ) : null}
      {children}
    </View>
  );
}

export default function CurateEventScreen() {
  const router = useRouter();
  const { isAdmin, cityId, scale, refresh, refreshPendingCount } = useApp();

  const [selectedCity, setSelectedCity] = useState(cityId);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Community');
  const [dateValue, setDateValue] = useState(null);
  const [timeValue, setTimeValue] = useState(null);
  const [venue, setVenue] = useState('');
  const [address, setAddress] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [repeat, setRepeat] = useState('once');
  const [count, setCount] = useState('4');
  const [submitting, setSubmitting] = useState(false);

  const inputFontSize = Math.round(baseFont.body * scale);

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed" size={40} color={colors.textMuted} />
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
          This curation tool is for moderators only.
        </ThemedText>
      </View>
    );
  }

  const onSubmit = async () => {
    if (!title.trim() || !venue.trim() || !dateValue) {
      Alert.alert('Almost there', 'Please fill in the event name, date, and venue.');
      return;
    }
    const n = repeat === 'once' ? 1 : Math.min(Math.max(parseInt(count, 10) || 1, 1), 12);

    try {
      setSubmitting(true);
      for (let i = 0; i < n; i++) {
        const d = new Date(dateValue);
        if (repeat === 'weekly') d.setDate(d.getDate() + 7 * i);
        else if (repeat === 'daily') d.setDate(d.getDate() + i);
        if (timeValue) d.setHours(timeValue.getHours(), timeValue.getMinutes(), 0, 0);
        else d.setHours(12, 0, 0, 0);

        const cityObj = CITIES.find((c) => c.id === selectedCity) || CITIES[0];
        // eslint-disable-next-line no-await-in-loop
        await insertEvent({
          cityId: selectedCity,
          title: title.trim(),
          category,
          emoji: EMOJI_BY_CAT[category] || '📅',
          start: d.toISOString(),
          end: null,
          venue: venue.trim(),
          address: address.trim() || `${cityObj.name}, ${cityObj.state}`,
          price: price.trim() || 'See details',
          host: 'Local Loop',
          description: description.trim() || 'No description provided.',
        });
      }
      refresh();
      refreshPendingCount();
      Alert.alert(
        'Published! 🎉',
        n > 1
          ? `${n} events added (${repeat}) and are live now.`
          : 'Event added and live now.',
        [{ text: 'Done', onPress: () => router.replace('/') }]
      );
    } catch (e) {
      Alert.alert('Could not add', e?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.intro}>
          <ThemedText size="title" weight="bold">Add an event</ThemedText>
          <ThemedText size="body" color={colors.textMuted}>
            Moderator quick-add — publishes instantly, any city.
          </ThemedText>
        </View>

        <Field label="City" required>
          <View style={styles.chipWrap}>
            {CITIES.map((c) => {
              const selected = c.id === selectedCity;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setSelectedCity(c.id)}
                  style={[
                    styles.chip,
                    { borderColor: selected ? colors.primary : colors.border },
                    selected && { backgroundColor: colors.primaryLight },
                  ]}
                >
                  <ThemedText
                    size="small"
                    weight={selected ? 'bold' : 'regular'}
                    color={selected ? colors.primary : colors.text}
                  >
                    {c.name}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Field label="Event name" required>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Saturday Farmers Market"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { fontSize: inputFontSize }]}
          />
        </Field>

        <Field label="Category" required>
          <View style={styles.chipWrap}>
            {CATEGORIES.map((cat) => {
              const selected = cat === category;
              const accent = categoryColor(cat);
              return (
                <Pressable
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={[
                    styles.chip,
                    { borderColor: selected ? accent : colors.border },
                    selected && { backgroundColor: accent + '18' },
                  ]}
                >
                  <ThemedText size="small">{EMOJI_BY_CAT[cat]}</ThemedText>
                  <ThemedText size="small" weight={selected ? 'bold' : 'regular'} color={selected ? accent : colors.text}>
                    {cat}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Field label="Date" required>
          <DateTimeField mode="date" value={dateValue} onChange={setDateValue} />
        </Field>

        <Field label="Start time">
          <DateTimeField mode="time" value={timeValue} onChange={setTimeValue} />
        </Field>

        <Field label="Repeats" hint="Great for weekly markets, classes, etc.">
          <View style={styles.chipWrap}>
            {REPEATS.map((r) => {
              const selected = r.key === repeat;
              return (
                <Pressable
                  key={r.key}
                  onPress={() => setRepeat(r.key)}
                  style={[
                    styles.chip,
                    { borderColor: selected ? colors.primary : colors.border },
                    selected && { backgroundColor: colors.primaryLight },
                  ]}
                >
                  <ThemedText size="small" weight={selected ? 'bold' : 'regular'} color={selected ? colors.primary : colors.text}>
                    {r.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </Field>

        {repeat !== 'once' ? (
          <Field label="How many times?" hint="Up to 12">
            <TextInput
              value={count}
              onChangeText={setCount}
              keyboardType="number-pad"
              maxLength={2}
              style={[styles.input, { fontSize: inputFontSize, width: 100 }]}
            />
          </Field>
        ) : null}

        <Field label="Venue" required>
          <TextInput
            value={venue}
            onChangeText={setVenue}
            placeholder="e.g. Riverside Park"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { fontSize: inputFontSize }]}
          />
        </Field>

        <Field label="Address" hint="Start typing — pick from suggestions">
          <AddressAutocomplete
            value={address}
            onChangeText={setAddress}
            placeholder="231 McManness Ave, Findlay, OH"
            fontSize={inputFontSize}
          />
        </Field>

        <Field label="Cost" hint="e.g. Free or $10">
          <TextInput
            value={price}
            onChangeText={setPrice}
            placeholder="Free"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { fontSize: inputFontSize }]}
          />
        </Field>

        <Field label="Description">
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="What should people know?"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.textArea, { fontSize: inputFontSize }]}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </Field>

        <Pressable
          style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
          onPress={onSubmit}
          disabled={submitting}
        >
          <Ionicons name="add-circle" size={22} color={colors.textInverse} />
          <ThemedText size="subtitle" weight="bold" color={colors.textInverse}>
            {submitting ? 'Adding…' : 'Publish Event'}
          </ThemedText>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: spacing.md, padding: spacing.xl, backgroundColor: colors.background,
  },
  intro: { marginBottom: spacing.lg, gap: 4 },
  field: { marginBottom: spacing.lg, gap: 4 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    color: colors.text,
    minHeight: 52,
  },
  textArea: { minHeight: 100, paddingTop: 14 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    minHeight: 44,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    minHeight: 56,
  },
});
