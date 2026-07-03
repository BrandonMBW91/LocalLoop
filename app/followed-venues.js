import React from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import ThemedText from '../src/components/ThemedText';
import EmptyState from '../src/components/EmptyState';
import { useApp } from '../src/context/AppContext';
import { colors, spacing, radius } from '../src/theme/theme';

// Lists the venues the user follows (toggled from the event detail screen) and
// lets them unfollow right here, so following isn't a one-way trip.
export default function FollowedVenuesScreen() {
  const { follows, toggleFollow } = useApp();

  if (follows.length === 0) {
    return (
      <>
        <Stack.Screen options={{ title: 'Followed Venues' }} />
        <View style={styles.screen}>
          <EmptyState
            icon="notifications-outline"
            title="Not following anyone yet"
            body="Open any event and tap Follow to keep up with a venue. The venues you follow show up here and under the Following filter."
            accent={colors.primary}
          />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Followed Venues' }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
      >
        <ThemedText size="small" color={colors.textMuted} style={styles.count}>
          Following {follows.length} {follows.length === 1 ? 'venue' : 'venues'}
        </ThemedText>
        <View style={styles.card}>
          {follows.map((venue, i) => (
            <View key={venue} style={[styles.row, i > 0 && styles.rowBorder]}>
              <Ionicons name="notifications" size={22} color={colors.primary} />
              <ThemedText size="body" weight="semibold" style={{ flex: 1, marginLeft: spacing.sm }} numberOfLines={2}>
                {venue}
              </ThemedText>
              <Pressable
                onPress={() => toggleFollow(venue)}
                hitSlop={10}
                style={styles.unfollowBtn}
                accessibilityRole="button"
                accessibilityLabel={`Unfollow ${venue}`}
              >
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  count: {
    marginLeft: spacing.xs,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
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
  unfollowBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    marginLeft: spacing.sm,
  },
});
