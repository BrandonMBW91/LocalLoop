import React, { useRef } from 'react';
import { Animated } from 'react-native';

// A drop-in for <Image> that fades in on load instead of hard-cutting from the
// grey placeholder box, and forwards onError so callers can fall back to a
// category icon on a 404/timeout. Pure RN Animated — OTA-safe, no new dependency.
export default function FadeInImage({ style, onError, ...props }) {
  const opacity = useRef(new Animated.Value(0)).current;
  return (
    <Animated.Image
      {...props}
      style={[style, { opacity }]}
      onLoad={() => {
        Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }).start();
      }}
      onError={onError}
    />
  );
}
