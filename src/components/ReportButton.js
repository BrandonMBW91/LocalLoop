import React, { useState } from 'react';
import { Pressable, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import { useApp } from '../context/AppContext';
import { colors, spacing, radius } from '../theme/theme';

// Small, low-emphasis "Report" control for detail screens. kind is one of
// 'event' | 'garage_sale' | 'food_truck'.
export default function ReportButton({ kind, id }) {
  const { reportListing } = useApp();
  const [done, setDone] = useState(false);

  const file = async (reason) => {
    try {
      await reportListing(kind, id, reason);
    } catch (e) {
      // Even if persistence fails, don't alarm the user; thank them anyway.
    }
    // Confirm inline (the button label/icon flips to "Reported — thank you").
    // We intentionally don't pop a second Alert here: showing one right as the
    // reason-picker Alert dismisses can leave a phantom dialog on some devices
    // that swallows the next tap (the back button appeared to "break").
    setDone(true);
  };

  const onPress = () => {
    if (done) return;
    Alert.alert('Report this listing', 'Why are you reporting it?', [
      { text: 'Inappropriate content', onPress: () => file('inappropriate') },
      { text: 'Spam or scam', onPress: () => file('spam') },
      { text: 'Wrong or misleading info', onPress: () => file('misinformation') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <Pressable
      onPress={onPress}
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
        {done ? 'Reported — thank you' : 'Report this listing'}
      </ThemedText>
    </Pressable>
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
});
