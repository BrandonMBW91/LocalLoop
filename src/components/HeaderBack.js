import React from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ThemedText from './ThemedText';
import { colors } from '../theme/theme';

// Shared header back control for every pushed screen. Unlike the default native
// back button, this can never become a dead no-op: if there's history it goes
// back, and if there somehow isn't (deep link, odd nav state) it falls back to
// Home — so a tap always does something predictable.
export default function HeaderBack() {
  const router = useRouter();
  const onPress = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  return (
    <Pressable
      onPress={onPress}
      hitSlop={16}
      style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 16, paddingVertical: 6 }}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <Ionicons name="chevron-back" size={26} color={colors.textInverse} />
      <ThemedText size="body" weight="semibold" color={colors.textInverse}>
        Back
      </ThemedText>
    </Pressable>
  );
}
