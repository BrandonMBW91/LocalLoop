import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { baseFont, colors } from '../theme/theme';
import { useApp } from '../context/AppContext';

// Text that automatically applies the user's accessibility text-size setting.
// Use `size` to pick a base from the theme; everything scales together.
export default function ThemedText({
  size = 'body',
  weight = 'regular',
  color = colors.text,
  style,
  children,
  ...rest
}) {
  const { scale } = useApp();
  const base = baseFont[size] ?? baseFont.body;
  const fontSize = Math.round(base * scale);

  // If a caller overrides fontSize inline (e.g. big emoji tiles), derive the
  // line-height from that final size so tall glyphs (emoji) aren't clipped.
  const flat = StyleSheet.flatten(style) || {};
  const finalSize = flat.fontSize ?? fontSize;
  const lineHeight = flat.lineHeight ?? Math.round(finalSize * 1.3);

  const fontWeight =
    weight === 'bold' ? '700' : weight === 'semibold' ? '600' : weight === 'medium' ? '500' : '400';

  return (
    <Text
      // Respect our scale but also allow OS-level font scaling up to a cap so
      // it never becomes unreadable/overflowing.
      maxFontSizeMultiplier={1.4}
      style={[{ fontSize, lineHeight, color, fontWeight }, style]}
      {...rest}
    >
      {children}
    </Text>
  );
}
