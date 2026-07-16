import React, { useEffect } from 'react';
import { View, StyleSheet, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from './ThemedText';
import FadeInImage from './FadeInImage';
import { useApp } from '../context/AppContext';
import { trackSponsor } from '../lib/db';
import { colors, spacing, radius } from '../theme/theme';

// Count each sponsor's impression once per app session, not once per remount —
// a windowed list re-mounts AdBanner repeatedly as it scrolls in/out of view.
const countedImpressions = new Set();

// A tel: link means "call this business"; anything else is a website to open.
function ctaFor(linkUrl) {
  if (!linkUrl) return null;
  if (/^tel:/i.test(linkUrl)) return { label: 'Call', icon: 'call' };
  return { label: 'Visit site', icon: 'open-outline' };
}

// Shows a real local sponsor when one is booked for the current city. Renders
// nothing when there's no sponsor — we don't clutter the public feed with a
// "your ad could be here" placeholder (that pitch lives on the Advertise screen).
// Pass `index` in a list so multiple slots rotate through the available sponsors.
export default function AdBanner({ index = 0 }) {
  const { sponsors = [], backendEnabled, noTrack } = useApp();
  const sponsor = sponsors.length ? sponsors[index % sponsors.length] : null;
  const track = backendEnabled && !noTrack; // real users only — never admin/dev/opted-out

  // Count an impression the first time a real ad is shown this session.
  useEffect(() => {
    if (track && sponsor?.id && !countedImpressions.has(sponsor.id)) {
      countedImpressions.add(sponsor.id);
      trackSponsor(sponsor.id, 'impression');
    }
  }, [track, sponsor?.id]);

  if (sponsor) {
    const cta = ctaFor(sponsor.linkUrl);
    const open = () => {
      if (track && sponsor.id) trackSponsor(sponsor.id, 'click');
      if (sponsor.linkUrl) Linking.openURL(sponsor.linkUrl).catch(() => {});
    };
    return (
      <View style={styles.wrap}>
        <Pressable
          onPress={open}
          disabled={!sponsor.linkUrl}
          style={({ pressed }) => [styles.sponsor, pressed && sponsor.linkUrl && { opacity: 0.85 }]}
          accessibilityRole={sponsor.linkUrl ? 'link' : 'text'}
          accessibilityLabel={
            cta
              ? `Sponsored by ${sponsor.title}. ${cta.label}.`
              : `Sponsored by ${sponsor.title}`
          }
        >
          {/* Accent bar signals a paid, premium slot without shouting "AD". */}
          <View style={styles.accentBar} />
          {sponsor.imageUrl ? (
            <FadeInImage source={{ uri: sponsor.imageUrl }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbFallback]}>
              <Ionicons name="storefront" size={28} color={colors.accent} />
            </View>
          )}
          <View style={styles.copy}>
            <View style={styles.tagRow}>
              <View style={styles.tagPill}>
                <ThemedText size="tiny" weight="bold" color={colors.accent} style={styles.tag}>
                  LOCAL SPONSOR
                </ThemedText>
              </View>
            </View>
            <ThemedText size="body" weight="bold" numberOfLines={1}>
              {sponsor.title}
            </ThemedText>
            {sponsor.body ? (
              <ThemedText size="small" color={colors.textMuted} numberOfLines={2}>
                {sponsor.body}
              </ThemedText>
            ) : null}
            {cta ? (
              <View style={styles.ctaRow}>
                <ThemedText size="small" weight="bold" color={colors.accent}>
                  {cta.label}
                </ThemedText>
                <Ionicons name={cta.icon} size={16} color={colors.accent} />
              </View>
            ) : null}
          </View>
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
    backgroundColor: colors.accentLight,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingRight: spacing.md,
    paddingLeft: spacing.md,
    overflow: 'hidden',
  },
  // Stays the base hue, not accentFill: nothing renders on this 4px rule, so
  // darkening it would only dull the signal without buying any contrast.
  accentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: colors.accent,
  },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  copy: {
    flex: 1,
    gap: spacing.xxs,
  },
  tagRow: {
    flexDirection: 'row',
  },
  tagPill: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  tag: {
    letterSpacing: 1,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
});
