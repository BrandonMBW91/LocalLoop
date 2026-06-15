import React, { useEffect } from 'react';
import { View, StyleSheet, Pressable, Image, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import { useApp } from '../context/AppContext';
import { trackSponsor } from '../lib/db';
import { colors, spacing, radius } from '../theme/theme';

// Count each sponsor's impression once per app session, not once per remount —
// a windowed list re-mounts AdBanner repeatedly as it scrolls in/out of view.
const countedImpressions = new Set();

// Shows a real local sponsor when one is booked for the current city. Renders
// nothing when there's no sponsor — we don't clutter the public feed with a
// "your ad could be here" placeholder (that pitch lives on the Advertise screen).
// Pass `index` in a list so multiple slots rotate through the available sponsors.
export default function AdBanner({ index = 0 }) {
  const { sponsors = [], backendEnabled } = useApp();
  const sponsor = sponsors.length ? sponsors[index % sponsors.length] : null;

  // Count an impression the first time a real ad is shown this session.
  useEffect(() => {
    if (backendEnabled && sponsor?.id && !countedImpressions.has(sponsor.id)) {
      countedImpressions.add(sponsor.id);
      trackSponsor(sponsor.id, 'impression');
    }
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

  return null;
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
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
