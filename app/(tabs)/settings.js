import React from 'react';
import { View, ScrollView, StyleSheet, Pressable, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import ThemedText from '../../src/components/ThemedText';
import { useApp } from '../../src/context/AppContext';
import { APP_VERSION, BUILD } from '../../src/version';
import { openReview } from '../../src/lib/review';
import { formatDateMedium, formatTime } from '../../src/utils/dates';
import { textScaleOptions, colors, spacing, radius } from '../../src/theme/theme';

// Which over-the-air update is actually running — auto-changes on every update
// (handy for confirming a fix reached the device vs. the original embedded build).
function updateLabel() {
  try {
    if (Updates.isEmbeddedLaunch || !Updates.updateId) return 'base build (no update yet)';
    const when = Updates.createdAt ? `${formatDateMedium(Updates.createdAt)} · ${formatTime(Updates.createdAt)}` : '';
    return `${when ? when + ' · ' : ''}…${Updates.updateId.slice(-6)}`;
  } catch {
    return '';
  }
}

function SectionTitle({ children }) {
  return (
    <ThemedText size="small" weight="bold" color={colors.textMuted} style={styles.sectionTitle}>
      {children}
    </ThemedText>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const {
    city,
    textScaleKey,
    setTextScale,
    savedIds,
    backendEnabled,
    signedIn,
    session,
    signOut,
    deleteAccount,
    isAdmin,
    pendingCount,
    resetOnboarding,
    interests,
    follows,
  } = useApp();

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You can sign back in anytime to post.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account and any events, garage sales, or food trucks you submitted. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount();
              Alert.alert('Account deleted', 'Your account and submissions have been removed.');
            } catch (e) {
              Alert.alert('Could not delete account', e?.message || 'Please try again in a moment.');
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
    >
      {/* City selector — opens a searchable picker so this page stays short */}
      <SectionTitle>YOUR CITY</SectionTitle>
      <View style={styles.card}>
        <Pressable
          style={styles.row}
          onPress={() => router.push('/city')}
          accessibilityRole="button"
          accessibilityLabel={`Change city, currently ${city.name}`}
        >
          <Ionicons name="location" size={24} color={colors.primary} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <ThemedText size="body" weight="bold">
              {city.name}, {city.state}
            </ThemedText>
            <ThemedText size="small" color={colors.textMuted}>
              {city.tagline} · tap to change
            </ThemedText>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
        </Pressable>
      </View>

      {/* Text size */}
      <SectionTitle>TEXT SIZE</SectionTitle>
      <View style={styles.card}>
        <View style={{ padding: spacing.md, gap: spacing.sm }}>
          <ThemedText size="body" color={colors.textMuted}>
            Make everything easier to read.
          </ThemedText>
          <View style={styles.scaleRow}>
            {textScaleOptions.map((opt) => {
              const selected = opt.key === textScaleKey;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setTextScale(opt.key)}
                  style={[styles.scaleBtn, selected && styles.scaleBtnSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <ThemedText
                    weight="bold"
                    color={selected ? colors.textInverse : colors.text}
                    style={{ fontSize: Math.round(18 * opt.scale) }}
                  >
                    A
                  </ThemedText>
                  <ThemedText
                    size="small"
                    weight={selected ? 'bold' : 'regular'}
                    color={selected ? colors.textInverse : colors.text}
                  >
                    {opt.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      {/* Your feed — interests + followed venues */}
      <SectionTitle>YOUR FEED</SectionTitle>
      <View style={styles.card}>
        <Pressable style={styles.row} onPress={() => router.push('/interests')}>
          <Ionicons name="sparkles" size={24} color={colors.primary} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <ThemedText size="body" weight="bold">Your interests</ThemedText>
            <ThemedText size="small" color={colors.textMuted}>
              {interests.length > 0 ? interests.join(', ') : 'Pick what to surface first'}
            </ThemedText>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
        </Pressable>
        <Pressable
          style={[styles.row, styles.rowBorder]}
          onPress={() => router.push('/followed-venues')}
          accessibilityRole="button"
          accessibilityLabel="Followed venues"
        >
          <Ionicons name="notifications" size={24} color={colors.primary} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <ThemedText size="body" weight="bold">Followed venues</ThemedText>
            <ThemedText size="small" color={colors.textMuted}>
              {follows.length > 0
                ? `Following ${follows.length} ${follows.length === 1 ? 'venue' : 'venues'}`
                : 'Follow a venue to track its events'}
            </ThemedText>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
        </Pressable>
      </View>

      {/* Saved */}
      <SectionTitle>SAVED EVENTS</SectionTitle>
      <View style={styles.card}>
        <Pressable style={styles.row} onPress={() => router.push('/saved')}>
          <Ionicons name="heart" size={24} color={colors.danger} />
          <ThemedText size="body" style={{ flex: 1, marginLeft: spacing.sm }}>
            {savedIds.length > 0
              ? `View your ${savedIds.length} saved ${savedIds.length === 1 ? 'event' : 'events'}`
              : 'No saved events yet'}
          </ThemedText>
          <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
        </Pressable>
      </View>

      {/* Account (only when a backend is configured) */}
      {backendEnabled ? (
        <>
          <SectionTitle>ACCOUNT</SectionTitle>
          <View style={styles.card}>
            {signedIn ? (
              <>
                <View style={styles.row}>
                  <Ionicons name="checkmark-circle" size={24} color={colors.success} />
                  <ThemedText size="body" style={{ flex: 1, marginLeft: spacing.sm }}>
                    Signed in{session?.user?.email ? ` as ${session.user.email}` : ''}
                  </ThemedText>
                </View>
                <Pressable style={[styles.row, styles.rowBorder]} onPress={confirmSignOut}>
                  <Ionicons name="log-out-outline" size={24} color={colors.danger} />
                  <ThemedText size="body" color={colors.danger} style={{ flex: 1, marginLeft: spacing.sm }}>
                    Sign out
                  </ThemedText>
                </Pressable>
                <Pressable style={[styles.row, styles.rowBorder]} onPress={confirmDelete}>
                  <Ionicons name="trash-outline" size={24} color={colors.danger} />
                  <ThemedText size="body" color={colors.danger} style={{ flex: 1, marginLeft: spacing.sm }}>
                    Delete account
                  </ThemedText>
                </Pressable>
              </>
            ) : (
              <Pressable style={styles.row} onPress={() => router.push('/sign-in')}>
                <Ionicons name="log-in-outline" size={24} color={colors.primary} />
                <ThemedText size="body" style={{ flex: 1, marginLeft: spacing.sm }}>
                  Sign in to post events & sales
                </ThemedText>
                <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
              </Pressable>
            )}
          </View>
        </>
      ) : null}

      {/* Moderator (only visible to admins) */}
      {isAdmin ? (
        <>
          <SectionTitle>MODERATOR</SectionTitle>
          <View style={styles.card}>
            <Pressable style={styles.row} onPress={() => router.push('/event/curate')}>
              <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
              <ThemedText size="body" style={{ flex: 1, marginLeft: spacing.sm }}>
                Add an event
              </ThemedText>
              <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
            </Pressable>
            <Pressable style={[styles.row, styles.rowBorder]} onPress={() => router.push('/moderate')}>
              <Ionicons name="shield-checkmark" size={24} color={colors.primary} />
              <ThemedText size="body" style={{ flex: 1, marginLeft: spacing.sm }}>
                Review submissions
              </ThemedText>
              {pendingCount > 0 ? (
                <View style={styles.countBadge}>
                  <ThemedText size="small" weight="bold" color={colors.textInverse}>
                    {pendingCount}
                  </ThemedText>
                </View>
              ) : null}
              <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
            </Pressable>
            <Pressable style={[styles.row, styles.rowBorder]} onPress={() => router.push('/ads')}>
              <Ionicons name="megaphone" size={24} color={colors.accent} />
              <ThemedText size="body" style={{ flex: 1, marginLeft: spacing.sm }}>
                Manage sponsors & ads
              </ThemedText>
              <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
            </Pressable>
            <Pressable style={[styles.row, styles.rowBorder]} onPress={() => router.push('/editor-pick')}>
              <Ionicons name="star" size={24} color={colors.accent} />
              <ThemedText size="body" style={{ flex: 1, marginLeft: spacing.sm }}>
                This week's pick
              </ThemedText>
              <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
            </Pressable>
            <Pressable style={[styles.row, styles.rowBorder]} onPress={() => router.push('/manage-deals')}>
              <Ionicons name="pricetags" size={24} color={colors.accent} />
              <ThemedText size="body" style={{ flex: 1, marginLeft: spacing.sm }}>
                Manage local deals
              </ThemedText>
              <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
            </Pressable>
            <Pressable style={[styles.row, styles.rowBorder]} onPress={() => router.push('/metrics')}>
              <Ionicons name="stats-chart" size={24} color={colors.primary} />
              <ThemedText size="body" style={{ flex: 1, marginLeft: spacing.sm }}>
                Reach & metrics
              </ThemedText>
              <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
        </>
      ) : null}

      {/* For businesses */}
      <SectionTitle>FOR BUSINESSES</SectionTitle>
      <View style={styles.card}>
        <Pressable style={styles.row} onPress={() => router.push('/promote')}>
          <Ionicons name="star" size={24} color={colors.accent} />
          <ThemedText size="body" style={{ flex: 1, marginLeft: spacing.sm }}>
            Advertise or feature a listing
          </ThemedText>
          <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
        </Pressable>
      </View>

      {/* About */}
      <SectionTitle>ABOUT</SectionTitle>
      <View style={styles.card}>
        <Pressable style={styles.row} onPress={openReview} accessibilityRole="button" accessibilityLabel="Rate Local Loop on the App Store">
          <Ionicons name="star-outline" size={24} color={colors.accent} />
          <ThemedText size="body" weight="semibold" style={{ flex: 1, marginLeft: spacing.sm }}>
            Rate Local Loop
          </ThemedText>
          <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
        </Pressable>
        <Pressable
          style={[styles.row, styles.rowBorder]}
          onPress={() => Linking.openURL('mailto:localloop@localloop.io')}
        >
          <Ionicons name="mail-outline" size={24} color={colors.primary} />
          <ThemedText size="body" style={{ flex: 1, marginLeft: spacing.sm }}>
            Contact us
          </ThemedText>
          <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
        </Pressable>
        <Pressable
          style={[styles.row, styles.rowBorder]}
          onPress={() =>
            Linking.openURL(
              'mailto:localloop@localloop.io?subject=' +
                encodeURIComponent('Local Loop Feature Request')
            )
          }
        >
          <Ionicons name="bulb-outline" size={24} color={colors.accent} />
          <ThemedText size="body" style={{ flex: 1, marginLeft: spacing.sm }}>
            Request a feature
          </ThemedText>
          <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
        </Pressable>
        <Pressable
          style={[styles.row, styles.rowBorder]}
          onPress={() => {
            resetOnboarding();
            router.replace('/welcome');
          }}
          accessibilityRole="button"
          accessibilityLabel="Show the welcome screen again"
        >
          <Ionicons name="sparkles-outline" size={24} color={colors.primary} />
          <ThemedText size="body" style={{ flex: 1, marginLeft: spacing.sm }}>
            Show welcome screen again
          </ThemedText>
          <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
        </Pressable>
        <View style={[styles.row, styles.rowBorder]}>
          <Ionicons name="information-circle-outline" size={24} color={colors.primary} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <ThemedText size="body">Version {APP_VERSION} (rev {BUILD})</ThemedText>
            <ThemedText size="small" color={colors.textMuted}>{updateLabel()}</ThemedText>
          </View>
        </View>
      </View>

      <ThemedText size="small" color={colors.textMuted} style={[styles.note, { textAlign: 'center', marginTop: spacing.lg }]}>
        Made with care for our local community ❤️
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  sectionTitle: {
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  countBadge: {
    backgroundColor: colors.danger,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  note: {
    marginTop: spacing.sm,
    marginLeft: spacing.xs,
  },
  scaleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  scaleBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  scaleBtnSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
});
