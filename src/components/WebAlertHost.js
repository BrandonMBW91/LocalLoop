import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { setAlertHandler } from '../lib/alertBus';
import { colors, spacing, radius } from '../theme/theme';

// A real, branded Alert dialog for web.
//
// react-native-web's Alert.alert is a no-op. The first fix mapped it onto
// window.confirm, but a binary OK/Cancel cannot express the dialogs this app
// actually shows, and it guessed WRONG in ways that corrupted data:
//   - "That address is in Findlay ... Post it there?" is [Post in Findlay]
//     [Keep Toledo] with NO cancel — confirm() gave the user no choice and
//     silently posted to the wrong town.
//   - "Is this the same event?" is [Cancel] [View it] [It's different, post it] —
//     clicking OK to say "yes, same" fired "post it" and created a duplicate.
// So render the REAL buttons instead of inferring intent. Dismissing (backdrop
// or Esc) runs the cancel button if there is one, and otherwise does nothing —
// never a destructive default.
export default function WebAlertHost() {
  const [dlg, setDlg] = useState(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    setAlertHandler((payload) => setDlg(payload));
    return () => setAlertHandler(null);
  }, []);

  if (!dlg) return null;
  const buttons = Array.isArray(dlg.buttons) && dlg.buttons.length ? dlg.buttons : [{ text: 'OK' }];

  const press = (b) => {
    setDlg(null);
    if (b && typeof b.onPress === 'function') b.onPress();
  };
  // Backdrop / Esc: only ever the explicit cancel action, never an action button.
  const dismiss = () => {
    const cancel = buttons.find((b) => b && b.style === 'cancel');
    setDlg(null);
    if (cancel && typeof cancel.onPress === 'function') cancel.onPress();
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={dismiss}>
      <Pressable style={styles.backdrop} onPress={dismiss}>
        {/* Stop backdrop dismissal when clicking inside the card. */}
        <Pressable style={styles.card} onPress={() => {}}>
          {!!dlg.title && <Text style={styles.title}>{dlg.title}</Text>}
          {!!dlg.message && <Text style={styles.message}>{dlg.message}</Text>}
          <View style={styles.buttons}>
            {buttons.map((b, i) => {
              const isCancel = b && b.style === 'cancel';
              const isDestructive = b && b.style === 'destructive';
              return (
                <Pressable
                  key={`${b?.text || 'btn'}-${i}`}
                  onPress={() => press(b)}
                  style={({ hovered }) => [
                    styles.button,
                    isCancel && styles.buttonCancel,
                    hovered && styles.buttonHover,
                  ]}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      isCancel && styles.buttonTextCancel,
                      isDestructive && styles.buttonTextDestructive,
                    ]}
                  >
                    {b?.text || 'OK'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.card || colors.background,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  message: { fontSize: 15, lineHeight: 21, color: colors.textMuted },
  buttons: { marginTop: spacing.md, gap: spacing.sm },
  button: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    cursor: 'pointer',
  },
  buttonHover: { opacity: 0.9 },
  buttonCancel: { backgroundColor: 'transparent' },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  buttonTextCancel: { color: colors.textMuted },
  buttonTextDestructive: { color: '#fff' },
});
