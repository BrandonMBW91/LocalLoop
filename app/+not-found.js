import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../src/theme/theme';

// Any URL that matches no route. Without this, expo-router renders its own bare
// "Unmatched Route" screen — an unbranded dead end with no way back to the feed.
// That matters most on web: the SPA catch-all serves index.html for EVERY path,
// so truncated shared links, stale event URLs, and mistyped paths all land here,
// including paid ad clicks.
export default function NotFound() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: 'Page not found' }} />
      <View style={styles.screen}>
        <Ionicons name="compass-outline" size={56} color={colors.primary} />
        <Text style={styles.title}>That page isn&apos;t here</Text>
        <Text style={styles.body}>
          The link may be old or mistyped. Your town&apos;s events, garage sales, and food trucks are
          still just a tap away.
        </Text>
        <Pressable style={styles.button} onPress={() => router.replace('/')}>
          <Text style={styles.buttonText}>See what&apos;s happening</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginTop: spacing.sm },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 420,
  },
  button: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
