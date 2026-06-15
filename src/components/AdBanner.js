import React, { useEffect } from 'react';
import { View, StyleSheet, Pressable, Image, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import { useApp } from '../context/AppContext';
import { trackSponsor } from '../lib/db';
import { colors, spacing, radius } from '../theme/theme';

// Shows a real local sponsor when one is booked for the current city, otherwise
// a friendly placeholder that doubles as a "your ad here" prompt. Pass `index`
// in a list so multiple slots rotate through the available sponsors.
export default function AdBanner({ index = 0, label = 'Local Business Ad' }) {
  const { sponsors = [], backendEnabled } = useApp();
  const sponsor = sponsors.length ? sponsors[index % sponsors.length] : null;

  // Count an impression each time a real ad is shown.
  useEffect(() => {
    if (backendEnabled && sponsor?.id) trackSponsor(sponsor.id, 'impression');
  }, [backendEnabled, sponsor?.id]);

  if (sponsor) {
    const open = () => {
      if (backendEnabled && sponsor.id) trackSponsor(sponsor.id, 'click');
      if (sponsor.linkUrl) Linking.openURL(sponsor.linkUrl).catch(() => {});
    };
    return (
      <View style={styles.wrap}>
        <Pressable
          onPress={open}
          disabled={!sponsor.linkUrl}
          style={styles.sponsor}
          accessibilityRole={sponsor.linkUrl ? 'link' : 'text'}
          accessibilityLabel={`Sponsored: ${sponsor.title}`}
        >
          {sponsor.imageUrl ? (
            <Image source={{ uri: sponsor.imageUrl }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbFallback]}>
              <Ionicons name="storefront" size={26} color={colors.accent} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <ThemedText size="tiny" color={colors.textMuted} style={styles.tag}>
              SPONSORED
            </ThemedText>
            <ThemedText size="body" weight="bold" numberOfLines={1}>
              {sponsor.title}
            </ThemedText>
            {sponsor.body ? (
              <ThemedText size="small" color={colors.textMuted} numberOfLines={2}>
                {sponsor.body}
              </ThemedText>
            ) : null}
          </View>
          {sponsor.linkUrl ? (
            <Ionicons name="open-outline" size={20} color={colors.textMuted} />
          ) : null}
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.banner}>
        <ThemedText size="tiny" color={colors.textMuted} style={styles.tag}>
          SPONSORED
        </ThemedText>
        <ThemedText size="small" weight="semibold" color={colors.textMuted}>
          {label}
        </ThemedText>
        <ThemedText size="tiny" color={colors.textMuted}>
          Your ad could be here — supports local events
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  banner: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  sponsor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.accentLight,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentLight,
  },
  tag: {
    letterSpacing: 1,
  },
});
