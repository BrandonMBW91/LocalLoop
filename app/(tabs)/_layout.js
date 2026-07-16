import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../src/theme/theme';
import { useApp } from '../../src/context/AppContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Big, clearly-labeled bottom tabs. Only three destinations to keep
// navigation simple for every age group.
export default function TabsLayout() {
  const { hydrated, onboarded, scale } = useApp();
  const insets = useSafeAreaInsets(); // so the tab bar clears the system nav bar

  // Don't flash the tabs before we know whether to show the welcome screen.
  if (!hydrated) return null;
  if (!onboarded) return <Redirect href="/welcome" />;

  // Honor the user's Text Size setting on the nav itself (the app's headline
  // accessibility feature), capped so 5 labels still fit on narrow phones.
  const navScale = Math.min(scale, 1.25);

  return (
    <Tabs
      screenOptions={{
        // primaryFill (not primary) because headerTintColor is white on top of it.
        headerStyle: { backgroundColor: colors.primaryFill },
        headerTintColor: colors.textInverse,
        headerTitleStyle: { fontWeight: '700', fontSize: Math.round(22 * navScale) },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          // React Navigation defaults the tab bar to WHITE. Without this the bar
          // stayed white under the dark app and dropped inactive labels to 2.5:1 —
          // nav chrome silently drifting from the palette because it is themed by
          // the library rather than by src/theme/theme.js.
          backgroundColor: colors.surface,
          // Add the bottom safe-area inset so the tab bar sits ABOVE the system
          // navigation bar (Android edge-to-edge gesture/3-button bar, iOS home
          // indicator) instead of being covered by it. insets.bottom is 0 on
          // devices without one, so this is a no-op there.
          height: Math.round(68 * navScale) + insets.bottom,
          paddingBottom: insets.bottom + 10,
          paddingTop: 6,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: Math.round(13 * navScale), fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Events',
          headerShown: false,
          tabBarLabel: 'Events',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar" size={size + 4} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="garage-sales"
        options={{
          title: 'Garage Sales',
          headerShown: false,
          tabBarLabel: 'Sales',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="pricetags" size={size + 4} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="food-trucks"
        options={{
          title: 'Food Trucks',
          headerShown: false,
          tabBarLabel: 'Food',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="fast-food" size={size + 4} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="post"
        options={{
          title: 'Post Something',
          tabBarLabel: 'Post',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle" size={size + 6} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size + 4} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
