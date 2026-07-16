import React, { useEffect, useRef, useState } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import ThemedText from '../../src/components/ThemedText';
import DateTimeField from '../../src/components/DateTimeField';
import AddressAutocomplete from '../../src/components/AddressAutocomplete';
import { useApp } from '../../src/context/AppContext';
import { updateEvent, updateOwnEvent } from '../../src/lib/db';
import { CATEGORIES } from '../../src/data/events';
import { formatTime } from '../../src/utils/dates';
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

// Admin-only event editor. Reached from the event detail screen's Edit button,
// which only shows for non-feed events (sourceUid null) — feed rows are
// re-upserted nightly by the aggregator, so editing them here would be
// clobbered. RLS (events_update: is_admin()) enforces the same server-side.
export default function EditEventScreen() {
  const { id: rawId } = useLocalSearchParams();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const router = useRouter();
  const { isAdmin, scale, refresh, findEventById, session } = useApp();
  const event = findEventById(id);

  // Prefill from the loaded event. State initializers run once, so a background
  // refresh can't wipe in-progress edits.
  const [title, setTitle] = useState(event?.title || '');
  const [category, setCategory] = useState(event?.category || 'Community');
  const [dateValue, setDateValue] = useState(event?.start ? new Date(event.start) : null);
  const [startTimeValue, setStartTimeValue] = useState(event?.start ? new Date(event.start) : null);
  const [endTimeValue, setEndTimeValue] = useState(event?.end ? new Date(event.end) : null);
  const [venue, setVenue] = useState(event?.venue || '');
  const [address, setAddress] = useState(event?.address || '');
  const [price, setPrice] = useState(event?.price || '');
  const [description, setDescription] = useState(event?.description || '');
  const [saving, setSaving] = useState(false);

  // Seed the form ONCE when the event first resolves. On a direct route load
  // (e.g. a web reload of /event/edit?id=X) the town data may arrive after
  // mount, so the initializers above captured empty values — without this, a
  // save would overwrite the event's real fields with blanks/placeholders.
  const seeded = useRef(Boolean(event));
  useEffect(() => {
    if (event && !seeded.current) {
      seeded.current = true;
      setTitle(event.title || '');
      setCategory(event.category || 'Community');
      setDateValue(event.start ? new Date(event.start) : null);
      setStartTimeValue(event.start ? new Date(event.start) : null);
      setEndTimeValue(event.end ? new Date(event.end) : null);
      setVenue(event.venue || '');
      setAddress(event.address || '');
      setPrice(event.price || '');
      setDescription(event.description || '');
    }
  }, [event]);

  const inputFontSize = Math.round(baseFont.body * scale);

  // Moderators can edit anything; everyone else only what they posted. The real
  // gate is server-side (RLS for admins, update_own_event's created_by check for
  // owners) — this just avoids showing a form that would fail on save.
  const isOwner = !!(session?.user?.id && event?.createdBy && session.user.id === event.createdBy);
  if (!isAdmin && !isOwner) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed" size={40} color={colors.textMuted} />
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
          You can only edit a listing you posted.
        </ThemedText>
      </View>
    );
  }
  if (!event) {
    return (
      <View style={styles.center}>
        <ThemedText size="title" weight="bold">Event not found</ThemedText>
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
          It may have been removed, or it is outside the loaded town.
        </ThemedText>
      </View>
    );
  }
  if (event.sourceUid) {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-download-outline" size={40} color={colors.textMuted} />
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center', paddingHorizontal: spacing.lg }}>
          This event comes from a calendar feed, so the nightly sync would overwrite
          any edits. Fix it at the source, or remove it and post a manual copy.
        </ThemedText>
      </View>
    );
  }

  const onSave = async (opts = {}) => {
    const { overnightOk = false } = opts;
    if (!title.trim() || !venue.trim() || !dateValue || !startTimeValue || !endTimeValue) {
      Alert.alert('Almost there', 'Please fill in the event name, date, start time, end time, and venue.');
      return;
    }

    // Same datetime rules as the post form: anchor both times to the picked
    // date; end at/before start means past-midnight, confirmed before rolling.
    const startDate = new Date(dateValue);
    startDate.setHours(startTimeValue.getHours(), startTimeValue.getMinutes(), 0, 0);
    const endDate = new Date(dateValue);
    endDate.setHours(endTimeValue.getHours(), endTimeValue.getMinutes(), 0, 0);
    if (endDate.getTime() <= startDate.getTime() && !overnightOk) {
      Alert.alert(
        'Check the end time',
        `You entered ${formatTime(startTimeValue)} to ${formatTime(endTimeValue)}. Does this event run past midnight into the next day?`,
        [
          { text: 'Fix the time', style: 'cancel' },
          { text: 'Yes, past midnight', onPress: () => onSave({ overnightOk: true }) },
        ]
      );
      return;
    }
    if (endDate.getTime() <= startDate.getTime()) endDate.setDate(endDate.getDate() + 1);

    try {
      setSaving(true);
      // Admins update the table directly (RLS allows admin only). The person who
      // posted it goes through update_own_event instead: it verifies ownership,
      // cannot touch status/featured, and re-pends the row for review.
      const save = isAdmin ? updateEvent : updateOwnEvent;
      await save(event.id, {
        title: title.trim(),
        category,
        emoji: EMOJI_BY_CAT[category] || '📅',
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        venue: venue.trim(),
        address: address.trim(),
        price: price.trim() || 'See details',
        description: description.trim() || 'No description provided.',
        // Location changed -> clear lat/lng so the nightly geocoder re-pins the
        // map (it only fills NULL coordinates; see updateEvent).
        clearCoords: venue.trim() !== (event.venue || '') || address.trim() !== (event.address || ''),
      });
      refresh();
      // An owner's edit re-pends the row (update_own_event), so say so plainly
      // rather than letting them wonder why their event vanished from the list.
      Alert.alert(
        'Saved',
        isAdmin
          ? 'The event has been updated.'
          : 'Your changes were saved and will show up once a moderator takes a quick look.',
        [
        { text: 'Done', onPress: () => (router.canGoBack() ? router.back() : router.replace('/')) },
      ]);
    } catch (e) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <Field label="Event name" required>
          <TextInput value={title} onChangeText={setTitle} placeholderTextColor={colors.textMuted} style={[styles.input, { fontSize: inputFontSize }]} />
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
                  style={[styles.catBtn, { borderColor: selected ? accent : colors.border }, selected && { backgroundColor: accent + '18' }]}
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

        <Field label="Start time" required>
          <DateTimeField mode="time" value={startTimeValue} onChange={setStartTimeValue} />
        </Field>

        <Field label="End time" hint="Ends after midnight? Just pick that time." required>
          <DateTimeField mode="time" value={endTimeValue} onChange={setEndTimeValue} />
        </Field>

        <Field label="Location / venue" required>
          <TextInput value={venue} onChangeText={setVenue} placeholderTextColor={colors.textMuted} style={[styles.input, { fontSize: inputFontSize }]} />
        </Field>

        <Field label="Street address">
          <AddressAutocomplete value={address} onChangeText={setAddress} placeholder="Street address" fontSize={inputFontSize} />
        </Field>

        <Field label="Cost">
          <TextInput value={price} onChangeText={setPrice} placeholder="Free" placeholderTextColor={colors.textMuted} style={[styles.input, { fontSize: inputFontSize }]} />
        </Field>

        <Field label="Description">
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.textArea, { fontSize: inputFontSize }]}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </Field>

        <Pressable
          style={({ pressed }) => [styles.saveBtn, saving && { opacity: 0.6 }, pressed && { opacity: 0.85 }]}
          onPress={() => onSave()}
          disabled={saving}
          accessibilityRole="button"
        >
          <Ionicons name="checkmark-circle" size={22} color={colors.textInverse} />
          <ThemedText size="subtitle" weight="bold" color={colors.textInverse}>
            {saving ? 'Saving…' : 'Save Changes'}
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
  textArea: { minHeight: 110, paddingTop: 14 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
  saveBtn: {
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
