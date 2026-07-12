import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Updates from 'expo-updates';
import { colors, spacing, radius, baseFont } from '../theme/theme';

// Catches any render/lifecycle error anywhere in the tree so a single bad screen
// shows a recoverable fallback instead of white-screening the whole app. This
// matters most for OTA updates: a JS render crash cannot be rolled back through
// the App Store, so without this the only recovery is the user deleting the app.
//
// Uses raw RN primitives + resolved theme tokens only (no ThemedText, no context)
// so the fallback still renders even when the crash is in a shared component or
// the app context itself. Class component because error boundaries have no hook
// equivalent.
export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Best-effort breadcrumb; must never itself throw.
    try {
      console.error('App error boundary caught:', error, info && info.componentStack);
    } catch (_) {}
  }

  handleReset = async () => {
    // Reloading the JS bundle is the cleanest recovery (clears any wedged state).
    // In dev / Expo Go reloadAsync throws, so fall back to just clearing the
    // boundary and re-rendering the tree.
    try {
      await Updates.reloadAsync();
    } catch (_) {
      this.setState({ error: null });
    }
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.wrap}>
          <Text style={styles.emoji}>🙈</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            This screen ran into a problem. Tap below to try again. If it keeps
            happening, close and reopen Local Loop.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
            onPress={this.handleReset}
            accessibilityRole="button"
          >
            <Text style={styles.btnText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  emoji: { fontSize: 52, marginBottom: spacing.md },
  title: {
    fontSize: baseFont.title,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: baseFont.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: spacing.lg,
  },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    minHeight: 52,
    justifyContent: 'center',
  },
  btnText: { fontSize: baseFont.body, fontWeight: '800', color: colors.textInverse },
});
