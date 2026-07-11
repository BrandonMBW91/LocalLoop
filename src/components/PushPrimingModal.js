import React from 'react';
import { Modal, View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import { useApp } from '../context/AppContext';
import { colors, spacing, radius } from '../theme/theme';

// Pre-permission "priming" screen. Shown BEFORE the OS notification prompt so a
// user who isn't ready taps "Not now" here (which never burns the one-shot OS
// prompt) instead of hard-declining the cold OS dialog. Only when they tap
// "Turn on" do we fire the real OS prompt. This is the single biggest lever on
// push reach (was ~9%: a cold prompt fired in a useEffect, then never re-asked).
const COPY = {
  onboarding: {
    title: "Never miss what's happening",
    body: 'Get a heads-up about new events, food trucks, and deals near you. You can turn it off anytime.',
  },
  save: {
    title: 'Want a reminder?',
    body: "Turn on notifications and we'll remind you before your saved events, plus flag new things happening nearby.",
  },
  general: {
    title: 'Stay in the loop',
    body: 'Get a heads-up about new events, food trucks, and deals near you. You can turn it off anytime.',
  },
};

export default function PushPrimingModal() {
  const { pushPrime, acceptPushPrime, dismissPushPrime } = useApp();
  if (!pushPrime) return null;
  const c = COPY[pushPrime] || COPY.general;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismissPushPrime}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="notifications" size={30} color={colors.primary} />
          </View>
          <ThemedText size="title" weight="bold" style={styles.title}>{c.title}</ThemedText>
          <ThemedText size="body" color={colors.textMuted} style={styles.body}>{c.body}</ThemedText>
          <Pressable style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]} onPress={acceptPushPrime} accessibilityRole="button">
            <ThemedText size="body" weight="bold" color={colors.textInverse}>Turn on notifications</ThemedText>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.6 }]} onPress={dismissPushPrime} accessibilityRole="button">
            <ThemedText size="body" weight="bold" color={colors.textMuted}>Not now</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { textAlign: 'center', marginBottom: spacing.sm },
  body: { textAlign: 'center', marginBottom: spacing.lg, lineHeight: 22 },
  primary: {
    alignSelf: 'stretch',
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  ghost: {
    alignSelf: 'stretch',
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
});
