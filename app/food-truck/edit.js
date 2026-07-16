import React, { useEffect, useState } from 'react';
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
import { updateOwnFoodTruck } from '../../src/lib/db';
import { CUISINES, CUISINE_EMOJI } from '../../src/data/foodTrucks';
import { formatTime } from '../../src/utils/dates';
import { colors, spacing, radius, baseFont } from '../../src/theme/theme';

// Edit a food-truck stop you posted. Mirrors app/event/edit.js: the server is the
// real gate (update_own_food_truck checks created_by = auth.uid(), refuses
// aggregator rows, cannot touch status/featured, and re-pends the row). Photos are
// not editable here yet.
function Field({ label, hint, children, required }) {
  return (
    <View style={styles.field}>
      <ThemedText size="small" weight="bold">
        {label}{required ? <ThemedText size="small" color={colors.textMuted}> (required)</ThemedText> : null}
      </ThemedText>
      {hint ? <ThemedText size="tiny" color={colors.textMuted} style={{ marginBottom: 4 }}>{hint}</ThemedText> : null}
      {children}
    </View>
  );
}

function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
const toDayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The table stores clock text ("11:30 AM"), not timestamps, so the picker round
// trips through formatTime rather than inventing a date.
function parseClock(s, dayRef) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?/i.exec(String(s || ''));
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (/p/i.test(m[3])) h += 12;
  const d = dayRef ? new Date(dayRef) : new Date();
  d.setHours(h, m[2] ? parseInt(m[2], 10) : 0, 0, 0);
  return d;
}

export default function EditFoodTruckScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { isAdmin, scale, refresh, findFoodTruckById, session } = useApp();
  const truck = findFoodTruckById(String(id));

  const [name, setName] = useState('');
  const [cuisine, setCuisine] = useState('Other');
  const [dateValue, setDateValue] = useState(null);
  const [startTimeValue, setStartTimeValue] = useState(null);
  const [endTimeValue, setEndTimeValue] = useState(null);
  const [locationName, setLocationName] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!truck) return;
    const day = parseDay(truck.date);
    setName(truck.name || '');
    setCuisine(truck.cuisine || 'Other');
    setDateValue(day);
    setStartTimeValue(parseClock(truck.startTime, day));
    setEndTimeValue(parseClock(truck.endTime, day));
    setLocationName(truck.locationName || '');
    setAddress(truck.address || '');
    setNote(truck.note || '');
  }, [truck]);

  const inputFontSize = Math.round(baseFont.body * scale);
  const isOwner = !!(session?.user?.id && truck?.createdBy && session.user.id === truck.createdBy);

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
  if (!truck) {
    return (
      <View style={styles.center}>
        <ThemedText size="title" weight="bold">Stop not found</ThemedText>
        <Pressable style={styles.btn} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <ThemedText size="body" weight="bold" color={colors.textInverse}>Go back</ThemedText>
        </Pressable>
      </View>
    );
  }
  // Calendar-pulled stops are owned by the nightly aggregator; an edit would be
  // overwritten on the next run, so do not pretend it is editable.
  if (truck.source === 'calendar') {
    return (
      <View style={styles.center}>
        <Ionicons name="sync-outline" size={40} color={colors.textMuted} />
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
          This stop comes from the truck&apos;s own calendar, so it updates automatically and cannot be edited here.
        </ThemedText>
      </View>
    );
  }

  const onSave = async () => {
    if (!name.trim() || !dateValue || !locationName.trim()) {
      Alert.alert('Almost there', 'Please fill in the truck name, date, and where it will be parked.');
      return;
    }
    try {
      setSaving(true);
      await updateOwnFoodTruck(truck.id, {
        name: name.trim(),
        cuisine,
        date: toDayKey(dateValue),
        startTime: startTimeValue ? formatTime(startTimeValue) : '',
        endTime: endTimeValue ? formatTime(endTimeValue) : '',
        locationName: locationName.trim(),
        address: address.trim(),
        note: note.trim(),
      });
      refresh();
      Alert.alert(
        'Saved',
        isAdmin
          ? 'The stop has been updated.'
          : 'Your changes were saved and will show up once a moderator takes a quick look.',
        [{ text: 'Done', onPress: () => (router.canGoBack() ? router.back() : router.replace('/')) }],
      );
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
        <Field label="Truck name" required>
          <TextInput value={name} onChangeText={setName} placeholderTextColor={colors.textMuted} style={[styles.input, { fontSize: inputFontSize }]} />
        </Field>

        <Field label="Food">
          <View style={styles.chips}>
            {CUISINES.map((c) => (
              <Pressable
                key={c}
                onPress={() => setCuisine(c)}
                style={[styles.chip, cuisine === c && { backgroundColor: colors.primaryFill, borderColor: colors.primary }]}
              >
                <ThemedText size="small" weight="bold" color={cuisine === c ? colors.textInverse : colors.text}>
                  {CUISINE_EMOJI[c] ? `${CUISINE_EMOJI[c]} ` : ''}{c}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </Field>

        <Field label="Date" required>
          <DateTimeField mode="date" value={dateValue} onChange={setDateValue} placeholder="Pick the day" />
        </Field>

        <Field label="Hours">
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <DateTimeField mode="time" value={startTimeValue} onChange={setStartTimeValue} placeholder="Start" />
            </View>
            <View style={{ flex: 1 }}>
              <DateTimeField mode="time" value={endTimeValue} onChange={setEndTimeValue} placeholder="End" />
            </View>
          </View>
        </Field>

        <Field label="Where it's parked" required>
          <TextInput value={locationName} onChangeText={setLocationName} placeholder="e.g. Levis Square" placeholderTextColor={colors.textMuted} style={[styles.input, { fontSize: inputFontSize }]} />
        </Field>

        <Field label="Address">
          <AddressAutocomplete value={address} onChangeText={setAddress} placeholder="Street address" />
        </Field>

        <Field label="Anything else">
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            placeholder="Specials, cash only, etc."
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.textarea, { fontSize: inputFontSize }]}
          />
        </Field>

        <Pressable style={[styles.btn, saving && { opacity: 0.6 }]} onPress={onSave} disabled={saving}>
          <ThemedText size="body" weight="bold" color={colors.textInverse}>{saving ? 'Saving...' : 'Save changes'}</ThemedText>
        </Pressable>
        {!isAdmin ? (
          <ThemedText size="tiny" color={colors.textMuted} style={{ textAlign: 'center', marginTop: spacing.sm }}>
            Edited listings go back through a quick review before they show again.
          </ThemedText>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md, backgroundColor: colors.background },
  field: { marginBottom: spacing.md, gap: 4 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 10,
    color: colors.text,
  },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  btn: {
    marginTop: spacing.sm,
    backgroundColor: colors.primaryFill,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
  },
});
