import React, { useState } from 'react';
import { View, ScrollView, TextInput, Pressable, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { submitBusinessClaim } from '../src/lib/db';
import { colors, spacing, radius, baseFont } from '../src/theme/theme';

const KINDS = [
  { key: 'food_truck', label: 'Food truck', icon: 'fast-food-outline' },
  { key: 'venue', label: 'Venue / business', icon: 'business-outline' },
  { key: 'organizer', label: 'Event organizer', icon: 'megaphone-outline' },
];

// Let an owner claim their truck / venue / organization. Gives us a verified
// contact and the natural path to a sponsorship conversation. Pre-fills the
// business name when arrived at from a listing ("Is this your truck? Claim it").
export default function ClaimScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { city, scale, deviceId } = useApp();

  const [name, setName] = useState(typeof params.name === 'string' ? params.name : '');
  const [kind, setKind] = useState(typeof params.kind === 'string' ? params.kind : 'food_truck');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fontSize = Math.round(baseFont.body * scale);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const onSubmit = async () => {
    if (name.trim().length < 2) {
      Alert.alert('Add your business name', 'Tell us the name people know you by.');
      return;
    }
    if (!emailOk) {
      Alert.alert('Check your email', 'We need a valid email so we can reach you back.');
      return;
    }
    try {
      setSubmitting(true);
      await submitBusinessClaim({
        name: name.trim(),
        cityId: city?.id,
        kind,
        contactName: contactName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        note: note.trim(),
        deviceId,
      });
      Alert.alert(
        'Thanks! 🎉',
        "We got your claim. We'll verify it and reach out at the email you gave us, usually within a day or two.",
        [{ text: 'Done', onPress: () => router.back() }]
      );
    } catch (e) {
      Alert.alert('Could not submit', e?.message || 'Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
        <ThemedText size="body" color={colors.textMuted} style={{ marginBottom: spacing.md }}>
          Run a truck, venue, or event in {city?.name || 'town'}? Claim it to manage how it shows up and hear
          about ways to reach more locals. Free, no obligation.
        </ThemedText>

        <ThemedText size="small" weight="bold" color={colors.textMuted} style={styles.label}>WHAT IS IT?</ThemedText>
        <View style={styles.kindRow}>
          {KINDS.map((k) => {
            const on = kind === k.key;
            return (
              <Pressable
                key={k.key}
                style={[styles.kindChip, on && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                onPress={() => setKind(k.key)}
              >
                <Ionicons name={k.icon} size={18} color={on ? colors.textInverse : colors.primary} />
                <ThemedText size="small" weight="bold" color={on ? colors.textInverse : colors.primary}>{k.label}</ThemedText>
              </Pressable>
            );
          })}
        </View>

        <Field label="Business name">
          <TextInput value={name} onChangeText={setName} placeholder="e.g. Lola's Eats & Treats"
            placeholderTextColor={colors.textMuted} style={[styles.input, { fontSize }]} />
        </Field>
        <Field label="Your name">
          <TextInput value={contactName} onChangeText={setContactName} placeholder="Who should we ask for?"
            placeholderTextColor={colors.textMuted} style={[styles.input, { fontSize }]} />
        </Field>
        <Field label="Email">
          <TextInput value={email} onChangeText={setEmail} placeholder="you@business.com" keyboardType="email-address"
            autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.textMuted}
            style={[styles.input, { fontSize }]} />
        </Field>
        <Field label="Phone (optional)">
          <TextInput value={phone} onChangeText={setPhone} placeholder="(419) 555-0100" keyboardType="phone-pad"
            placeholderTextColor={colors.textMuted} style={[styles.input, { fontSize }]} />
        </Field>
        <Field label="Anything else? (optional)">
          <TextInput value={note} onChangeText={setNote} placeholder="Tell us about your business"
            placeholderTextColor={colors.textMuted} multiline
            style={[styles.input, { fontSize, height: 90, textAlignVertical: 'top' }]} />
        </Field>

        <Pressable
          style={[styles.submitBtn, (submitting || name.trim().length < 2 || !emailOk) && { opacity: 0.5 }]}
          onPress={onSubmit}
          disabled={submitting || name.trim().length < 2 || !emailOk}
        >
          <Ionicons name="checkmark-circle" size={22} color={colors.textInverse} />
          <ThemedText size="body" weight="bold" color={colors.textInverse}>
            {submitting ? 'Sending…' : 'Submit claim'}
          </ThemedText>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <ThemedText size="small" weight="bold" color={colors.textMuted} style={styles.label}>{label.toUpperCase()}</ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  label: { marginBottom: spacing.xs, letterSpacing: 0.5 },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  kindChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 8,
  },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.text,
  },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: spacing.md,
    minHeight: 52, marginTop: spacing.sm,
  },
});
