import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme/theme';

// Shown on a detail screen while a deep-linked / cache-miss item is still being
// fetched, so a real record never flashes the "not found" screen first. `tint`
// matches the screen's category hero color.
export default function DetailSkeleton({ tint = colors.surfaceAlt }) {
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={styles.screen}>
      <View style={[styles.hero, { backgroundColor: tint }]} />
      <View style={styles.content}>
        <Animated.View style={[styles.line, { width: '70%', height: 26, opacity: pulse }]} />
        <Animated.View style={[styles.btn, { opacity: pulse }]} />
        <Animated.View style={[styles.card, { opacity: pulse }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  hero: { height: 180 },
  content: { padding: spacing.md, gap: spacing.md },
  line: { borderRadius: 6, backgroundColor: colors.skeleton, marginTop: spacing.sm },
  btn: { height: 56, borderRadius: radius.pill, backgroundColor: colors.skeleton },
  card: { height: 120, borderRadius: radius.md, backgroundColor: colors.skeleton, marginTop: spacing.sm },
});
