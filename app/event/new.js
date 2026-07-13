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
import { submitEventSource } from '../../src/lib/db';
import { screenContent } from '../../src/utils/moderation';
import { findDuplicateEvent } from '../../src/utils/dedup';
import { formatShortDate, formatTime } from '../../src/utils/dates';
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

export default function SubmitScreen() {
  const router = useRouter();
  const { city, scale, events, addSubmittedEvent, backendEnabled, rulesAccepted } = useApp();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Community');
  const [dateValue, setDateValue] = useState(null);
  const [startTimeValue, setStartTimeValue] = useState(null);
  const [endTimeValue, setEndTimeValue] = useState(null);
  const [venue, setVenue] = useState('');
  const [address, setAddress] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Self-serve calendar intake (mirrors the food-truck "add your calendar" flow).
  const [calName, setCalName] = useState('');
  const [calUrl, setCalUrl] = useState('');
  const [calSubmitting, setCalSubmitting] = useState(false);

  const inputFontSize = Math.round(baseFont.body * scale);

  const reset = () => {
    setTitle(''); setCategory('Community'); setDateValue(null); setStartTimeValue(null); setEndTimeValue(null);
    setVenue(''); setAddress(''); setPrice(''); setDescription(''); setContact('');
  };

  const onAddCalendar = async () => {
    if (!calName.trim()) {
      Alert.alert('Add a name', 'Give your calendar a name (your venue, organization, or series), then paste the link.');
      return;
    }
    const url = calUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      Alert.alert('Check the link', 'Paste your calendar link. It should start with http (a Google Calendar or website .ics link).');
      return;
    }
    try {
      setCalSubmitting(true);
      await submitEventSource({ name: calName.trim(), cityId: city.id, url, category, contact: contact.trim() });
      setCalUrl(''); setCalName('');
      Alert.alert(
        'Thanks! 🎉',
        `We'll review your calendar, then keep your events in ${city.name} updated automatically, so you never post them one by one. This can take a day.`,
        [{ text: 'Done', onPress: () => router.replace('/') }]
      );
    } catch (e) {
      Alert.alert('Could not add calendar', e?.message || 'Something went wrong. Please try again.');
    } finally {
      setCalSubmitting(false);
    }
  };

  const onSubmit = async (opts = {}) => {
    const { skipDupCheck = false, overnightOk = false } = opts;
    if (!title.trim() || !venue.trim() || !dateValue || !startTimeValue || !endTimeValue) {
      Alert.alert(
        'Almost there',
        'Please fill in the event name, date, start time, end time, and location.'
      );
      return;
    }

    const screen = screenContent([title, venue, description]);
    if (!screen.ok) {
      Alert.alert('Please revise your post', screen.message);
      return;
    }

    // Anchor both times to the picked date.
    const startDate = new Date(dateValue);
    startDate.setHours(startTimeValue.getHours(), startTimeValue.getMinutes(), 0, 0);
    const endDate = new Date(dateValue);
    endDate.setHours(endTimeValue.getHours(), endTimeValue.getMinutes(), 0, 0);

    // End at or before start is ambiguous: the event either runs past midnight
    // (9 PM to 1 AM) or the times were entered wrong. Confirm before rolling the
    // end to the next day, so a reversed or duplicate time isn't silently saved
    // as a day-long event.
    if (endDate.getTime() <= startDate.getTime() && !overnightOk) {
      Alert.alert(
        'Check the end time',
        `You entered ${formatTime(startTimeValue)} to ${formatTime(endTimeValue)}. Does this event run past midnight into the next day?`,
        [
          { text: 'Fix the time', style: 'cancel' },
          { text: 'Yes, past midnight', onPress: () => onSubmit({ ...opts, overnightOk: true }) },
        ]
      );
      return;
    }
    if (endDate.getTime() <= startDate.getTime()) endDate.setDate(endDate.getDate() + 1);
    const start = startDate.toISOString();
    const end = endDate.toISOString();

    // Gently catch likely duplicates of an event already on Local Loop (a feed
    // or a neighbor may have posted the same thing). Soft prompt, not a block.
    if (!skipDupCheck) {
      const dup = findDuplicateEvent({ id: null, title: title.trim(), start }, events);
      if (dup) {
        Alert.alert(
          'This might already be posted',
          `“${dup.title}” is already on Local Loop for ${formatShortDate(dup.start)}${dup.venue ? ' at ' + dup.venue : ''}. Is this the same event?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'View it', onPress: () => router.push(`/event/${dup.id}`) },
            { text: 'It’s different, post it', onPress: () => onSubmit({ ...opts, skipDupCheck: true }) },
          ]
        );
        return;
      }
    }

    const event = {
      id: `user-${Date.now()}`,
      cityId: city.id,
      title: title.trim(),
      category,
      emoji: EMOJI_BY_CAT[category] || '📅',
      start,
      end,
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
        `Your event has been submitted. It is reviewed, then shown to everyone in ${city.name}.`,
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
            Tell your neighbors in {city.name} what’s happening. Always free to post.
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

        {backendEnabled ? (
          <View style={styles.calCard}>
            <View style={styles.calHead}>
              <Ionicons name="calendar" size={20} color={colors.accent} />
              <ThemedText size="body" weight="bold" color={colors.accent}>Have a whole calendar of events?</ThemedText>
            </View>
            <ThemedText size="small" color={colors.textMuted} style={{ marginBottom: 8 }}>
              Add your Google Calendar or website calendar link once and we'll keep your events updated automatically, so you never post them one by one. We review it first. Add the calendar name and category above.
            </ThemedText>
            <ThemedText size="small" color={colors.textMuted} style={{ marginBottom: 8 }}>
              Keep something private? Anything marked Private in your calendar (or on a separate personal calendar) stays off Local Loop. Only your public events show.
            </ThemedText>
            <TextInput
              value={calName}
              onChangeText={setCalName}
              placeholder="Calendar name (your venue, org, or series)"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { fontSize: inputFontSize, marginBottom: spacing.sm }]}
            />
            <TextInput
              value={calUrl}
              onChangeText={setCalUrl}
              placeholder="https://calendar.google.com/…/basic.ics"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[styles.input, { fontSize: inputFontSize }]}
            />
            <Pressable
              style={[styles.calBtn, calSubmitting && { opacity: 0.6 }]}
              onPress={onAddCalendar}
              disabled={calSubmitting}
              accessibilityRole="button"
              accessibilityLabel="Add my calendar"
            >
              <Ionicons name="add-circle" size={20} color={colors.accent} />
              <ThemedText size="body" weight="bold" color={colors.accent}>
                {calSubmitting ? 'Sending…' : 'Add my calendar'}
              </ThemedText>
            </Pressable>
            <ThemedText size="tiny" color={colors.textMuted} style={{ marginTop: 6, textAlign: 'center' }}>
              Free, and your events update themselves from your calendar.
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.orRow}>
          <View style={styles.orLine} />
          <ThemedText size="small" color={colors.textMuted}>or add a single event</ThemedText>
          <View style={styles.orLine} />
        </View>

        <Field label="Date" required>
          <DateTimeField mode="date" value={dateValue} onChange={setDateValue} />
        </Field>

        <Field label="Start time" required>
          <DateTimeField mode="time" value={startTimeValue} onChange={setStartTimeValue} />
        </Field>

        <Field label="End time" hint="Ends after midnight? Just pick that time." required>
          <DateTimeField mode="time" value={endTimeValue} onChange={setEndTimeValue} />
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

        <Field label="Street address" hint="Start typing, then pick a suggestion">
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

        <Field label="Your contact (organizer)" hint="Optional. Not shown publicly.">
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
          onPress={() => onSubmit()}
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
  calCard: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  calHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6 },
  calBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    borderWidth: 1.5, borderColor: colors.accent, borderRadius: radius.pill,
    paddingVertical: spacing.md, marginTop: spacing.md, minHeight: 52,
  },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  orLine: { flex: 1, height: 1, backgroundColor: colors.border },
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
