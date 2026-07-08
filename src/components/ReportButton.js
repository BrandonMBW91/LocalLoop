import React, { useState } from 'react';
import { Pressable, StyleSheet, Modal, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import { useApp } from '../context/AppContext';
import { colors, spacing, radius } from '../theme/theme';

// Small, low-emphasis "Report" control for detail screens. kind is one of
// 'event' | 'garage_sale' | 'food_truck'.
//
// The reason picker is a real Modal, NOT Alert.alert: Android caps alerts at
// THREE buttons, so our 3 reasons + Cancel silently lost the Cancel — and
// Android alerts aren't tap-outside/back dismissible by default, which trapped
// a tester with no way out short of killing the app. A Modal gives both
// platforms the same sheet with an explicit Cancel, backdrop-tap dismiss, and
// hardware-back dismiss (onRequestClose).
const REASONS = [
  { key: 'misinformation', label: 'Wrong or misleading info' },
  { key: 'spam', label: 'Spam or scam' },
  { key: 'inappropriate', label: 'Inappropriate content' },
];

export default function ReportButton({ kind, id }) {
  const { reportListing } = useApp();
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState(false);

  const file = async (reason) => {
    setOpen(false);
    try {
      await reportListing(kind, id, reason);
    } catch (e) {
      // Even if persistence fails, don't alarm the user; thank them anyway.
    }
    // Confirm inline (the button label/icon flips to "Reported. Thank you").
    setDone(true);
  };

  return (
    <>
      <Pressable
        onPress={() => !done && setOpen(true)}
        style={styles.btn}
        accessibilityRole="button"
        accessibilityLabel="Report this listing"
      >
        <Ionicons
          name={done ? 'checkmark-circle-outline' : 'flag-outline'}
          size={18}
          color={colors.textMuted}
        />
        <ThemedText size="small" color={colors.textMuted}>
          {done ? 'Reported. Thank you' : 'Report this listing'}
        </ThemedText>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* Backdrop tap closes — the sheet itself swallows its own taps. */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close">
          <Pressable style={styles.sheet} onPress={() => {}}>
            <ThemedText size="subtitle" weight="bold">Report this listing</ThemedText>
            <ThemedText size="small" color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
              Why are you reporting it?
            </ThemedText>
            {REASONS.map((r) => (
              <Pressable
                key={r.key}
                onPress={() => file(r.key)}
                style={styles.option}
                accessibilityRole="button"
              >
                <ThemedText size="body" weight="semibold" color={colors.primary}>
                  {r.label}
                </ThemedText>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setOpen(false)}
              style={[styles.option, styles.cancel]}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <ThemedText size="body" weight="bold">Cancel</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    marginHorizontal: spacing.md,
    borderRadius: radius.md,
    minHeight: 44,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  option: {
    paddingVertical: spacing.md,
    minHeight: 48,
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancel: {
    marginTop: spacing.xs,
  },
});
