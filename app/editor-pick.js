import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, TextInput, Pressable, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { saveEditorPick, clearEditorPick } from '../src/lib/db';
import { colors, spacing, radius, baseFont } from '../src/theme/theme';

// A labeled text field. Defined at module scope (not inside the screen) so it
// keeps a stable component identity — otherwise every keystroke remounts the
// TextInput and the keyboard loses focus after one character.
function Field({ label, hint, value, onChange, multiline, placeholder, fs }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <ThemedText size="body" weight="semibold">{label}</ThemedText>
      {hint ? <ThemedText size="small" color={colors.textMuted} style={{ marginBottom: 4 }}>{hint}</ThemedText> : null}
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        style={[styles.input, { fontSize: fs }, multiline && { minHeight: 90, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

// Admin: set the hand-curated "This Week's Pick" for the current town.
export default function EditorPickScreen() {
  const router = useRouter();
  const { isAdmin, city, cityId, editorPick, scale, refresh } = useApp();
  const [title, setTitle] = useState(editorPick?.title || '');
  const [note, setNote] = useState(editorPick?.note || '');
  const [detail, setDetail] = useState(editorPick?.detail || '');
  const [linkUrl, setLinkUrl] = useState(editorPick?.linkUrl || '');
  const [busy, setBusy] = useState(false);
  const fs = Math.round(baseFont.body * scale);

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed" size={40} color={colors.textMuted} />
        <ThemedText size="body" color={colors.textMuted}>This area is for moderators.</ThemedText>
      </View>
    );
  }

  const save = async () => {
    if (!title.trim()) { Alert.alert('Add a title', "What's the pick?"); return; }
    setBusy(true);
    try {
      await saveEditorPick(cityId, { title: title.trim(), note: note.trim(), detail: detail.trim(), linkUrl: linkUrl.trim() });
      await refresh();
      Alert.alert('Saved', `Your pick is live at the top of ${city.name}.`, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await clearEditorPick(cityId);
      await refresh();
      router.back();
    } catch (e) {
      setBusy(false);
      Alert.alert('Could not remove', e?.message || 'Please try again.');
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
      <ThemedText size="small" color={colors.textMuted} style={{ marginBottom: spacing.md }}>
        Pick one thing worth highlighting in {city.name} this week. It shows in your own voice at the top of the events list.
      </ThemedText>
      <Field label="The pick" hint="e.g. Balloonfest is back this weekend" value={title} onChange={setTitle} placeholder="What shouldn't they miss?" fs={fs} />
      <Field label="Your note" hint="A short, personal tip" value={note} onChange={setNote} multiline placeholder="Get there early Saturday for the morning launch…" fs={fs} />
      <Field label="When / where" hint="Optional" value={detail} onChange={setDetail} placeholder="Sat–Sun · Riverside Park · Free" fs={fs} />
      <Field label="Link" hint="Optional — tickets or more info (https://…)" value={linkUrl} onChange={setLinkUrl} placeholder="https://…" fs={fs} />

      <Pressable style={[styles.btn, busy && { opacity: 0.6 }]} onPress={save} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.textInverse} /> : (
          <ThemedText size="subtitle" weight="bold" color={colors.textInverse}>Make this the pick</ThemedText>
        )}
      </Pressable>
      {editorPick ? (
        <Pressable style={styles.removeBtn} onPress={remove} disabled={busy}>
          <ThemedText size="body" weight="bold" color={colors.danger}>Remove current pick</ThemedText>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  input: {
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12,
    color: colors.text, marginTop: 6,
  },
  btn: {
    backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: spacing.md,
    alignItems: 'center', justifyContent: 'center', minHeight: 54, marginTop: spacing.sm,
  },
  removeBtn: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.sm },
});
