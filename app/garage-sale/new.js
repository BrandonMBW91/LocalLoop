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
import PhotoPicker from '../../src/components/PhotoPicker';
import DateTimeField from '../../src/components/DateTimeField';
import AddressAutocomplete from '../../src/components/AddressAutocomplete';
import { useApp } from '../../src/context/AppContext';
import { screenContent } from '../../src/utils/moderation';
import { SALE_ITEMS, SALE_TYPES } from '../../src/data/garageSales';
import { formatTime, toDateString } from '../../src/utils/dates';
import { colors, spacing, radius, baseFont } from '../../src/theme/theme';

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

export default function NewGarageSaleScreen() {
  const router = useRouter();
  const { city, scale, addSubmittedGarageSale, backendEnabled, rulesAccepted } = useApp();

  const [title, setTitle] = useState('');
  const [type, setType] = useState('Garage Sale');
  const [startDateValue, setStartDateValue] = useState(null);
  const [endDateValue, setEndDateValue] = useState(null);
  const [dailyStartValue, setDailyStartValue] = useState(null);
  const [dailyEndValue, setDailyEndValue] = useState(null);
  const [address, setAddress] = useState('');
  const [items, setItems] = useState([]);
  const [host, setHost] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const inputFontSize = Math.round(baseFont.body * scale);

  const toggleItem = (item) =>
    setItems((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );

  const onSubmit = async () => {
    if (!title.trim() || !address.trim() || !startDateValue) {
      Alert.alert(
        'Almost there',
        'Please fill in the sale name, address, and start date.'
      );
      return;
    }

    const screen = screenContent([title, address, note]);
    if (!screen.ok) {
      Alert.alert('Please revise your post', screen.message);
      return;
    }

    const startISO = toDateString(startDateValue);
    const sale = {
      id: `usersale-${Date.now()}`,
      cityId: city.id,
      title: title.trim(),
      type,
      start: startISO,
      end: endDateValue ? toDateString(endDateValue) : startISO,
      dailyStart: dailyStartValue ? formatTime(dailyStartValue) : '8:00 AM',
      dailyEnd: dailyEndValue ? formatTime(dailyEndValue) : '2:00 PM',
      address: address.trim(),
      neighborhood: '',
      items,
      host: host.trim() || 'Community submission',
      pending: true,
      note: note.trim() || '',
      _photos: photos,
    };

    try {
      setSubmitting(true);
      await addSubmittedGarageSale(sale);
      Alert.alert(
        'Thank you! 🪧',
        'Your garage sale has been submitted. It is reviewed and then shown to everyone in ' +
          city.name +
          '.',
        [{ text: 'View Garage Sales', onPress: () => router.replace('/garage-sales') }]
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
    return <Redirect href={{ pathname: '/rules', params: { next: '/garage-sale/new' } }} />;
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
          <ThemedText size="title" weight="bold">Post your garage sale</ThemedText>
          <ThemedText size="body" color={colors.textMuted}>
            Let your neighbors in {city.name} know. It’s free.
          </ThemedText>
          <View style={styles.ruleNote}>
            <Ionicons name="information-circle" size={18} color={colors.garageSale} />
            <ThemedText size="small" color={colors.garageSale} style={{ flex: 1 }}>
              This is for yard / garage / estate / moving sales — not for selling a
              single item.
            </ThemedText>
          </View>
        </View>

        <Field label="Sale name" required>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Big Multi-Family Garage Sale"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { fontSize: inputFontSize }]}
          />
        </Field>

        <Field label="Type of sale">
          <View style={styles.chipWrap}>
            {SALE_TYPES.map((t) => {
              const selected = t === type;
              return (
                <Pressable
                  key={t}
                  onPress={() => setType(t)}
                  style={[
                    styles.chip,
                    { borderColor: selected ? colors.garageSale : colors.border },
                    selected && { backgroundColor: colors.garageSaleLight },
                  ]}
                >
                  <ThemedText
                    size="small"
                    weight={selected ? 'bold' : 'regular'}
                    color={selected ? colors.garageSale : colors.text}
                  >
                    {t}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Field label="Start date" required>
          <DateTimeField
            mode="date"
            value={startDateValue}
            onChange={setStartDateValue}
            accent={colors.garageSale}
          />
        </Field>

        <Field label="End date" hint="Same day? Leave blank">
          <DateTimeField
            mode="date"
            value={endDateValue}
            onChange={setEndDateValue}
            accent={colors.garageSale}
          />
        </Field>

        <Field label="Opens at">
          <DateTimeField
            mode="time"
            value={dailyStartValue}
            onChange={setDailyStartValue}
            accent={colors.garageSale}
          />
        </Field>

        <Field label="Closes at">
          <DateTimeField
            mode="time"
            value={dailyEndValue}
            onChange={setDailyEndValue}
            accent={colors.garageSale}
          />
        </Field>

        <Field label="Address" hint="Start typing — pick from suggestions" required>
          <AddressAutocomplete
            value={address}
            onChangeText={setAddress}
            placeholder="1224 Western Ave, Findlay, OH"
            accent={colors.garageSale}
            fontSize={inputFontSize}
          />
        </Field>

        <Field label="What are you selling?" hint="Tap all that apply">
          <View style={styles.chipWrap}>
            {SALE_ITEMS.map((item) => {
              const selected = items.includes(item);
              return (
                <Pressable
                  key={item}
                  onPress={() => toggleItem(item)}
                  style={[
                    styles.chip,
                    { borderColor: selected ? colors.garageSale : colors.border },
                    selected && { backgroundColor: colors.garageSaleLight },
                  ]}
                >
                  {selected ? (
                    <Ionicons name="checkmark" size={16} color={colors.garageSale} />
                  ) : null}
                  <ThemedText
                    size="small"
                    weight={selected ? 'bold' : 'regular'}
                    color={selected ? colors.garageSale : colors.text}
                  >
                    {item}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Field label="Photos" hint="Add up to 4 — show off your best items">
          <PhotoPicker
            photos={photos}
            onChange={setPhotos}
            max={4}
            accent={colors.garageSale}
          />
        </Field>

        <Field label="Details" hint="Early birds? Cash only? Big items?">
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Anything shoppers should know..."
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.textArea, { fontSize: inputFontSize }]}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </Field>

        <Field label="Your name or contact" hint="Optional — not shown publicly">
          <TextInput
            value={host}
            onChangeText={setHost}
            placeholder="The Miller Family"
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
            {submitting ? 'Posting…' : 'Post Garage Sale'}
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
  ruleNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.garageSaleLight,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
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
  row: { flexDirection: 'row', gap: spacing.md },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
    backgroundColor: colors.garageSale,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    minHeight: 56,
  },
  disclaimer: { textAlign: 'center', marginTop: spacing.md, paddingHorizontal: spacing.md },
});
