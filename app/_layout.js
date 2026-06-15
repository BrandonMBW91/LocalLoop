import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import { AppProvider } from '../src/context/AppContext';
import HeaderBack from '../src/components/HeaderBack';
import { colors } from '../src/theme/theme';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.primary },
              headerTintColor: colors.textInverse,
              headerTitleStyle: { fontWeight: '700', fontSize: 20 },
              contentStyle: { backgroundColor: colors.background },
              // A shared back control on every pushed screen that always works
              // (falls back to Home if there's no history) — the native back
              // button was intermittently unresponsive after dialogs/navigation.
              headerLeft: () => <HeaderBack />,
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="welcome" options={{ headerShown: false, animation: 'fade' }} />
            <Stack.Screen
              name="event/[id]"
              options={{ title: 'Event Details', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="event/new"
              options={{ title: 'Post an Event', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="event/curate"
              options={{ title: 'Add an Event', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="garage-sale/[id]"
              options={{ title: 'Garage Sale', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="garage-sale/new"
              options={{ title: 'Post a Garage Sale', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="food-truck/[id]"
              options={{ title: 'Food Truck', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="food-truck/new"
              options={{ title: 'Post a Food Truck', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="sign-in"
              options={{ title: 'Sign In', presentation: 'modal', headerBackTitle: 'Close' }}
            />
            <Stack.Screen
              name="rules"
              options={{ title: 'Community Rules', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="promote"
              options={{ title: 'Advertise', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="moderate"
              options={{ title: 'Review Submissions', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="saved"
              options={{ title: 'Saved Events', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="ads"
              options={{ title: 'Sponsors & Ads', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="metrics"
              options={{ title: 'Reach & Metrics', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="city"
              options={{ title: 'Choose Your City', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="deals"
              options={{ title: 'Local Deals', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="manage-deals"
              options={{ title: 'Manage Deals', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="map"
              options={{ title: 'Events Map', headerBackTitle: 'Back' }}
            />
          </Stack>
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
