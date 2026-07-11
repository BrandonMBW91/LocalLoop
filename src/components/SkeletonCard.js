import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme/theme';

// A card-shaped placeholder shown while a list loads. A slow opacity pulse reads
// as "content is coming" rather than "frozen/broken," and the shadow/elevation
// match the real card so the hand-off doesn't visibly lift or shift the layout.
function SkeletonCard({ pulse }) {
  return (
    <View style={styles.card}>
      <Animated.View style={[styles.chip, { opacity: pulse }]} />
      <View style={styles.body}>
        <Animated.View style={[styles.line, { width: '34%', height: 12, opacity: pulse }]} />
        <Animated.View style={[styles.line, { width: '88%', height: 18, marginTop: 6, opacity: pulse }]} />
        <Animated.View style={[styles.line, { width: '58%', opacity: pulse }]} />
        <Animated.View style={[styles.line, { width: '46%', opacity: pulse }]} />
      </View>
    </View>
  );
}

export default function SkeletonList({ count = 6 }) {
  // One shared pulse drives every placeholder block (native driver, negligible cost).
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
    <View style={{ paddingTop: spacing.sm }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} pulse={pulse} />
      ))}
    </View>
  );
}

const block = colors.skeleton;

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  chip: {
    width: 58,
    height: 66,
    borderRadius: radius.md,
    backgroundColor: block,
  },
  body: { flex: 1, gap: spacing.sm, paddingTop: spacing.xxs },
  line: {
    height: 13,
    borderRadius: 6,
    backgroundColor: block,
  },
});
