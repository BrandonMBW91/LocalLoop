import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../src/theme/theme';

// Big, clearly-labeled bottom tabs. Only three destinations to keep
// navigation simple for every age group.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.textInverse,
        headerTitleStyle: { fontWeight: '700', fontSize: 22 },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          height: 68,
          paddingBottom: 10,
          paddingTop: 6,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
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
