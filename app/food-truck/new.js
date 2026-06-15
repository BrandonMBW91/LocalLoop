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
import { CUISINES, CUISINE_EMOJI } from '../../src/data/foodTrucks';
import { formatTime, toDateString } from '../../src/utils/dates';
import { colors, spacing, radius, baseFont } from '../../src/theme/theme';

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

export default function NewFoodTruckScreen() {
  const router = useRouter();
  const { city, scale, addSubmittedFoodTruck, backendEnabled, rulesAccepted } = useApp();

  const [name, setName] = useState('');
  const [cuisine, setCuisine] = useState('Tacos');
  const [dateValue, setDateValue] = useState(null);
  const [startTimeValue, setStartTimeValue] = useState(null);
  const [endTimeValue, setEndTimeValue] = useState(null);
  const [locationName, setLocationName] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [host, setHost] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const inputFontSize = Math.round(baseFont.body * scale);

  const onSubmit = async () => {
    if (!name.trim() || !dateValue || !locationName.trim()) {
      Alert.alert('Almost there', 'Please fill in the truck name, date, and location.');
      return;
    }

    const screen = screenContent([name, locationName, note]);
    if (!screen.ok) {
      Alert.alert('Please revise your post', screen.message);
      return;
    }

    const truck = {
      id: `usertruck-${Date.now()}`,
      cityId: city.id,
      name: name.trim(),
      cuisine,
      date: toDateString(dateValue),
      startTime: startTimeValue ? formatTime(startTimeValue) : '11:00 AM',
      endTime: endTimeValue ? formatTime(endTimeValue) : '2:00 PM',
      locationName: locationName.trim(),
      address: address.trim() || city.name + ', ' + city.state,
      host: host.trim() || name.trim(),
      pending: true,
      note: note.trim() || '',
    };

    try {
      setSubmitting(true);
      await addSubmittedFoodTruck(truck);
      Alert.alert(
        'Thank you! 🚚',
        'Your food truck stop has been submitted. It is reviewed and then shown to everyone in ' +
          city.name +
          '.',
        [{ text: 'View Food Trucks', onPress: () => router.replace('/food-trucks') }]
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
    return <Redirect href={{ pathname: '/rules', params: { next: '/food-truck/new' } }} />;
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
          <ThemedText size="title" weight="bold">Post your food truck</ThemedText>
          <ThemedText size="body" color={colors.textMuted}>
            Tell {city.name} where to find you today. It’s free.
          </ThemedText>
        </View>

        <Field label="Truck name" required>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Flag City Tacos"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { fontSize: inputFontSize }]}
          />
        </Field>

        <Field label="Type of food" required>
          <View style={styles.chipWrap}>
            {CUISINES.map((c) => {
              const selected = c === cuisine;
              return (
                <Pressable
                  key={c}
                  onPress={() => setCuisine(c)}
                  style={[
                    styles.chip,
                    { borderColor: selected ? colors.foodTruck : colors.border },
                    selected && { backgroundColor: colors.foodTruckLight },
                  ]}
                >
                  <ThemedText size="small">{CUISINE_EMOJI[c]}</ThemedText>
                  <ThemedText
                    size="small"
                    weight={selected ? 'bold' : 'regular'}
                    color={selected ? colors.foodTruck : colors.text}
                  >
                    {c}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Field label="Date" required>
          <DateTimeField
            mode="date"
            value={dateValue}
            onChange={setDateValue}
            accent={colors.foodTruck}
          />
        </Field>

        <Field label="Starts">
          <DateTimeField
            mode="time"
            value={startTimeValue}
            onChange={setStartTimeValue}
            accent={colors.foodTruck}
          />
        </Field>

        <Field label="Ends">
          <DateTimeField
            mode="time"
            value={endTimeValue}
            onChange={setEndTimeValue}
            accent={colors.foodTruck}
          />
        </Field>

        <Field label="Location name" hint="Where you'll park" required>
          <TextInput
            value={locationName}
            onChangeText={setLocationName}
            placeholder="e.g. Riverside Park"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { fontSize: inputFontSize }]}
          />
        </Field>

        <Field label="Street address" hint="Start typing — pick from suggestions">
          <AddressAutocomplete
            value={address}
            onChangeText={setAddress}
            placeholder="231 McManness Ave, Findlay, OH"
            accent={colors.foodTruck}
            fontSize={inputFontSize}
          />
        </Field>

        <Field label="What's on the menu?" hint="Specials, prices, dietary options">
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Tell people what you're serving..."
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.textArea, { fontSize: inputFontSize }]}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </Field>

        <Field label="Your contact" hint="Optional — not shown publicly">
          <TextInput
            value={host}
            onChangeText={setHost}
            placeholder="Name, phone, or social media"
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
          <Ionicons name="megaphone" size={22} color={colors.textInverse} />
          <ThemedText size="subtitle" weight="bold" color={colors.textInverse}>
            {submitting ? 'Posting…' : 'Post Food Truck'}
          </ThemedText>
        </Pressable>

        <ThemedText size="small" color={colors.textMuted} style={styles.disclaimer}>
          Posts are reviewed before appearing for everyone in {city.name}.
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
  textArea: { minHeight: 110, paddingTop: 14 },
  row: { flexDirection: 'row', gap: spacing.md },
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
    backgroundColor: colors.foodTruck,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    minHeight: 56,
  },
  disclaimer: { textAlign: 'center', marginTop: spacing.md, paddingHorizontal: spacing.md },
});
