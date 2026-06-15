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
import { Redirect, useRouter } from 'expo-router';
import ThemedText from '../../src/components/ThemedText';
import DateTimeField from '../../src/components/DateTimeField';
import AddressAutocomplete from '../../src/components/AddressAutocomplete';
import { useApp } from '../../src/context/AppContext';
import { screenContent } from '../../src/utils/moderation';
import { CATEGORIES } from '../../src/data/events';
import { colors, spacing, radius, baseFont, categoryColor } from '../../src/theme/theme';

const EMOJI_BY_CAT = {
  Music: '🎶', Family: '👨‍👩‍👧', Food: '🍽️', Sports: '🏅',
  Arts: '🎨', Community: '🤝', Market: '🛍️', Education: '📚',
};

function Field({ label, hint, children, required }) {
  return (
    <View style={styles.field}>
      <ThemedText size="body" weight="semibold">
        {label}
        {required ? <ThemedText color={colors.danger}> *</ThemedText> : null}
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

export default function SubmitScreen() {
  const router = useRouter();
  const { city, scale, addSubmittedEvent, backendEnabled, rulesAccepted } = useApp();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Community');
  const [dateValue, setDateValue] = useState(null);
  const [timeValue, setTimeValue] = useState(null);
  const [venue, setVenue] = useState('');
  const [address, setAddress] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const inputFontSize = Math.round(baseFont.body * scale);

  const reset = () => {
    setTitle(''); setCategory('Community'); setDateValue(null); setTimeValue(null);
    setVenue(''); setAddress(''); setPrice(''); setDescription(''); setContact('');
  };

  const onSubmit = async () => {
    if (!title.trim() || !venue.trim() || !dateValue) {
      Alert.alert(
        'Almost there',
        'Please fill in at least the event name, date, and location.'
      );
      return;
    }

    const screen = screenContent([title, venue, description]);
    if (!screen.ok) {
      Alert.alert('Please revise your post', screen.message);
      return;
    }

    const start = combineDateTime(dateValue, timeValue);

    const event = {
      id: `user-${Date.now()}`,
      cityId: city.id,
      title: title.trim(),
      category,
      emoji: EMOJI_BY_CAT[category] || '📅',
      start,
      end: null,
      venue: venue.trim(),
      address: address.trim() || city.name + ', ' + city.state,
      price: price.trim() || 'See details',
      host: contact.trim() || 'Community submission',
      featured: false,
      pending: true,
      description: description.trim() || 'No description provided.',
    };

    try {
      setSubmitting(true);
      await addSubmittedEvent(event);
      Alert.alert(
        'Thank you! 🎉',
        'Your event has been submitted. It will be reviewed and then shown to everyone in ' +
          city.name +
          '.',
        [{ text: 'View Events', onPress: () => { reset(); router.replace('/'); } }]
      );
    } catch (e) {
      Alert.alert(
        'Could not submit',
        e?.message || 'Something went wrong. Please check your connection and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (backendEnabled && !rulesAccepted) {
    return <Redirect href={{ pathname: '/rules', params: { next: '/event/new' } }} />;
  }

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
          <ThemedText size="title" weight="bold">
            Share a local event
          </ThemedText>
          <ThemedText size="body" color={colors.textMuted}>
            Tell your neighbors in {city.name} what’s happening. It’s free.
          </ThemedText>
        </View>

        <Field label="Event name" required>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Summer Block Party"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { fontSize: inputFontSize }]}
          />
        </Field>

        <Field label="Category" required>
          <View style={styles.catGrid}>
            {CATEGORIES.map((cat) => {
              const selected = cat === category;
              const accent = categoryColor(cat);
              return (
                <Pressable
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={[
                    styles.catBtn,
                    { borderColor: selected ? accent : colors.border },
                    selected && { backgroundColor: accent + '18' },
                  ]}
                >
                  <ThemedText size="small">{EMOJI_BY_CAT[cat]}</ThemedText>
                  <ThemedText
                    size="small"
                    weight={selected ? 'bold' : 'regular'}
                    color={selected ? accent : colors.text}
                  >
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

        <Field label="Location / venue" required>
          <TextInput
            value={venue}
            onChangeText={setVenue}
            placeholder="e.g. Riverside Park"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { fontSize: inputFontSize }]}
          />
        </Field>

        <Field label="Street address" hint="Start typing — pick from the suggestions">
          <AddressAutocomplete
            value={address}
            onChangeText={setAddress}
            placeholder="231 McManness Ave, Findlay, OH"
            fontSize={inputFontSize}
          />
        </Field>

        <Field label="Cost" hint="Optional, e.g. Free or $10">
          <TextInput
            value={price}
            onChangeText={setPrice}
            placeholder="Free"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { fontSize: inputFontSize }]}
          />
        </Field>

        <Field label="Description" hint="What should people know?">
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Tell people what to expect..."
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.textArea, { fontSize: inputFontSize }]}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </Field>

        <Field label="Your contact (organizer)" hint="Optional, not shown publicly in the prototype">
          <TextInput
            value={contact}
            onChangeText={setContact}
            placeholder="Name, email, or phone"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { fontSize: inputFontSize }]}
          />
        </Field>

        <Pressable
          style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
          onPress={onSubmit}
          disabled={submitting}
          accessibilityRole="button"
        >
          <Ionicons name="paper-plane" size={22} color={colors.textInverse} />
          <ThemedText size="subtitle" weight="bold" color={colors.textInverse}>
            {submitting ? 'Submitting…' : 'Submit Event'}
          </ThemedText>
        </Pressable>

        <ThemedText size="small" color={colors.textMuted} style={styles.disclaimer}>
          Submitted events are reviewed before appearing for everyone. We keep
          {' '}{city.name} friendly and family-appropriate.
        </ThemedText>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Combine the picked date with the picked time into an ISO datetime string.
function combineDateTime(dateVal, timeVal) {
  const d = new Date(dateVal);
  if (timeVal) {
    d.setHours(timeVal.getHours(), timeVal.getMinutes(), 0, 0);
  } else {
    d.setHours(12, 0, 0, 0); // default to noon if no time picked
  }
  return d.toISOString();
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
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
  textArea: {
    minHeight: 110,
    paddingTop: 14,
  },
  row: { flexDirection: 'row', gap: spacing.md },
  catGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  catBtn: {
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
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    minHeight: 56,
  },
  disclaimer: {
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
});
