import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  AppState,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { colors, spacing, radius, baseFont } from '../src/theme/theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignInScreen() {
  const router = useRouter();
  const { next } = useLocalSearchParams();
  const { requestOtp, verifyOtp, scale } = useApp();

  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [clipCode, setClipCode] = useState(''); // a 6-digit code found on the clipboard
  const codeRef = useRef(null);

  const inputFontSize = Math.round(baseFont.title * scale);

  // Look for a 6-digit code on the clipboard so we can offer a one-tap paste
  // (the user copies it from their email and comes back). Best-effort + never
  // throws — if anything fails we just don't show the paste chip.
  const checkClipboard = useCallback(async () => {
    try {
      const s = await Clipboard.getStringAsync();
      const m = (s || '').match(/\b\d{6}\b/);
      setClipCode(m ? m[0] : '');
    } catch {
      setClipCode('');
    }
  }, []);

  // On the code step, check the clipboard now and again whenever the app returns
  // to the foreground (e.g. after switching to Mail to copy the code).
  useEffect(() => {
    if (step !== 'code') return undefined;
    checkClipboard();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') checkClipboard();
    });
    return () => sub.remove();
  }, [step, checkClipboard]);

  // When we move to the code step, the email keyboard is still open. If we focus
  // the code field while it's open, iOS reuses the alphabetic keyboard instead
  // of switching to numeric. So we dismiss it (in sendCode) and only focus the
  // code field once the keyboard has FULLY hidden — then it opens fresh numeric.
  useEffect(() => {
    if (step !== 'code') return undefined;
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      codeRef.current?.focus();
      sub.remove();
    });
    // Fallback if no keyboard was open to hide.
    const t = setTimeout(() => codeRef.current?.focus(), 500);
    return () => {
      sub.remove();
      clearTimeout(t);
    };
  }, [step]);

  const sendCode = async () => {
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      Alert.alert('Check the email', 'Please enter a valid email address.');
      return;
    }
    try {
      setBusy(true);
      const { error } = await requestOtp(clean);
      if (error) throw error;
      setStep('code');
      // Close the email keyboard; the keyboardDidHide effect then focuses the
      // code field once it's fully hidden, so a fresh numeric keypad opens.
      Keyboard.dismiss();
    } catch (e) {
      Alert.alert('Could not send code', e?.message || 'Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async () => {
    const clean = email.trim().toLowerCase();
    if (!code.trim()) {
      Alert.alert('Enter the code', 'Please enter the code we emailed you.');
      return;
    }
    try {
      setBusy(true);
      const { error } = await verifyOtp(clean, code.trim());
      if (error) throw error;
      if (typeof next === 'string' && next) router.replace(next);
      else router.back();
    } catch (e) {
      Alert.alert('That code didn’t work', e?.message || 'Please double-check and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <View style={styles.iconCircle}>
          <Ionicons name="mail" size={40} color={colors.primary} />
        </View>

        {step === 'email' ? (
          <>
            <ThemedText size="title" weight="bold" style={styles.center}>
              Sign in to post
            </ThemedText>
            <ThemedText size="body" color={colors.textMuted} style={styles.center}>
              We’ll email you a one-time code. You only need it to post.
              Browsing is always free and open.
            </ThemedText>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { fontSize: inputFontSize }]}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              autoFocus
              accessibilityLabel="Email address"
            />
            <Pressable
              style={[styles.btn, busy && { opacity: 0.6 }]}
              onPress={sendCode}
              disabled={busy}
            >
              {busy ? (
                <View style={styles.btnBusy}>
                  <ActivityIndicator color={colors.textInverse} />
                  <ThemedText size="subtitle" weight="bold" color={colors.textInverse}>
                    Sending…
                  </ThemedText>
                </View>
              ) : (
                <ThemedText size="subtitle" weight="bold" color={colors.textInverse}>
                  Email me a code
                </ThemedText>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <ThemedText size="title" weight="bold" style={styles.center}>
              Enter your code
            </ThemedText>
            <ThemedText size="body" color={colors.textMuted} style={styles.center}>
              We sent a code to {email.trim().toLowerCase()}.
            </ThemedText>
            {clipCode && clipCode !== code ? (
              <Pressable
                onPress={() => {
                  setCode(clipCode);
                  Keyboard.dismiss();
                }}
                style={styles.pasteChip}
                accessibilityRole="button"
                accessibilityLabel={`Paste code ${clipCode}`}
              >
                <Ionicons name="clipboard-outline" size={18} color={colors.primary} />
                <ThemedText size="body" weight="bold" color={colors.primary}>
                  Paste {clipCode}
                </ThemedText>
              </Pressable>
            ) : null}
            <TextInput
              ref={codeRef}
              value={code}
              onChangeText={(t) => setCode(t.replace(/[^0-9]/g, ''))}
              placeholder="123456"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, styles.codeInput, { fontSize: inputFontSize }]}
              keyboardType="number-pad"
              inputMode="numeric"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              accessibilityLabel="Verification code"
            />
            <Pressable
              style={[styles.btn, busy && { opacity: 0.6 }]}
              onPress={confirmCode}
              disabled={busy}
            >
              {busy ? (
                <View style={styles.btnBusy}>
                  <ActivityIndicator color={colors.textInverse} />
                  <ThemedText size="subtitle" weight="bold" color={colors.textInverse}>
                    Verifying…
                  </ThemedText>
                </View>
              ) : (
                <ThemedText size="subtitle" weight="bold" color={colors.textInverse}>
                  Confirm & continue
                </ThemedText>
              )}
            </Pressable>
            <Pressable onPress={() => setStep('email')} style={styles.linkBtn}>
              <ThemedText size="body" weight="semibold" color={colors.primary}>
                Use a different email
              </ThemedText>
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  inner: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'center',
    gap: spacing.md,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  center: { textAlign: 'center' },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 16,
    color: colors.text,
    minHeight: 60,
    marginTop: spacing.md,
  },
  codeInput: {
    textAlign: 'center',
    letterSpacing: 4,
  },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    marginTop: spacing.sm,
  },
  btnBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  linkBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  pasteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
    marginTop: spacing.md,
    minHeight: 48,
  },
});
