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
import { updateOwnGarageSale } from '../../src/lib/db';
import { SALE_ITEMS, SALE_TYPES } from '../../src/data/garageSales';
import { colors, spacing, radius, baseFont } from '../../src/theme/theme';

// Edit a garage sale you posted. Mirrors app/event/edit.js: the server is the real
// gate (update_own_garage_sale checks created_by = auth.uid(), cannot touch
// status/featured, and re-pends the row), so this screen only decides whether the
// form is worth showing. Photos are not editable here yet.
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

// 'YYYY-MM-DD' -> local Date (never Date.parse, which reads it as UTC midnight and
// lands the picker on the previous evening).
function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
const toDayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function EditGarageSaleScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { isAdmin, scale, refresh, findGarageSaleById, session } = useApp();
  const sale = findGarageSaleById(String(id));

  const [title, setTitle] = useState('');
  const [type, setType] = useState('Garage Sale');
  const [startDateValue, setStartDateValue] = useState(null);
  const [endDateValue, setEndDateValue] = useState(null);
  const [dailyStart, setDailyStart] = useState('');
  const [dailyEnd, setDailyEnd] = useState('');
  const [address, setAddress] = useState('');
  const [items, setItems] = useState([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sale) return;
    setTitle(sale.title || '');
    setType(sale.type || 'Garage Sale');
    setStartDateValue(parseDay(sale.start));
    setEndDateValue(parseDay(sale.end));
    setDailyStart(sale.dailyStart || '');
    setDailyEnd(sale.dailyEnd || '');
    setAddress(sale.address || '');
    setItems(Array.isArray(sale.items) ? sale.items : []);
    setNote(sale.note || '');
  }, [sale]);

  const inputFontSize = Math.round(baseFont.body * scale);
  const isOwner = !!(session?.user?.id && sale?.createdBy && session.user.id === sale.createdBy);

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
  if (!sale) {
    return (
      <View style={styles.center}>
        <ThemedText size="title" weight="bold">Sale not found</ThemedText>
        <Pressable style={styles.btn} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <ThemedText size="body" weight="bold" color={colors.textInverse}>Go back</ThemedText>
        </Pressable>
      </View>
    );
  }

  const onSave = async () => {
    if (!title.trim() || !address.trim() || !startDateValue) {
      Alert.alert('Almost there', 'Please fill in the sale name, address, and start date.');
      return;
    }
    if (endDateValue && endDateValue < startDateValue) {
      Alert.alert('Check the dates', 'The last day cannot be before the first day.');
      return;
    }
    try {
      setSaving(true);
      await updateOwnGarageSale(sale.id, {
        title: title.trim(),
        type,
        start: toDayKey(startDateValue),
        end: endDateValue ? toDayKey(endDateValue) : null,
        dailyStart,
        dailyEnd,
        address: address.trim(),
        neighborhood: sale.neighborhood || '',
        note: note.trim(),
        items,
      });
      refresh();
      Alert.alert(
        'Saved',
        isAdmin
          ? 'The sale has been updated.'
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
        <Field label="Sale name" required>
          <TextInput value={title} onChangeText={setTitle} placeholderTextColor={colors.textMuted} style={[styles.input, { fontSize: inputFontSize }]} />
        </Field>

        <Field label="Type of sale">
          <View style={styles.chips}>
            {SALE_TYPES.map((t) => (
              <Pressable
                key={t}
                onPress={() => setType(t)}
                style={[styles.chip, type === t && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              >
                <ThemedText size="small" weight="bold" color={type === t ? colors.textInverse : colors.text}>{t}</ThemedText>
              </Pressable>
            ))}
          </View>
        </Field>

        <Field label="First day" required>
          <DateTimeField mode="date" value={startDateValue} onChange={setStartDateValue} placeholder="Pick the first day" />
        </Field>
        <Field label="Last day" hint="Leave empty for a one-day sale.">
          <DateTimeField mode="date" value={endDateValue} onChange={setEndDateValue} placeholder="Pick the last day" />
        </Field>

        <Field label="Hours" hint="Same hours each day, e.g. 8 AM to 2 PM.">
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TextInput value={dailyStart} onChangeText={setDailyStart} placeholder="8 AM" placeholderTextColor={colors.textMuted} style={[styles.input, { flex: 1, fontSize: inputFontSize }]} />
            <TextInput value={dailyEnd} onChangeText={setDailyEnd} placeholder="2 PM" placeholderTextColor={colors.textMuted} style={[styles.input, { flex: 1, fontSize: inputFontSize }]} />
          </View>
        </Field>

        <Field label="Address" required>
          <AddressAutocomplete value={address} onChangeText={setAddress} placeholder="Street address" />
        </Field>

        <Field label="What's for sale" hint="Tap everything that applies.">
          <View style={styles.chips}>
            {SALE_ITEMS.map((item) => {
              const selected = items.includes(item);
              return (
                <Pressable
                  key={item}
                  onPress={() => setItems((prev) => (selected ? prev.filter((x) => x !== item) : [...prev, item]))}
                  style={[styles.chip, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                >
                  <ThemedText size="small" weight="bold" color={selected ? colors.textInverse : colors.text}>{item}</ThemedText>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Field label="Anything else">
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            placeholder="Cash only, rain date, etc."
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
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
  },
});
