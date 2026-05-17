import React from 'react';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 5000 },
  },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerTintColor: '#111827',
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: '#F9FAFB' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Gojo' }} />
        <Stack.Screen name="camera" options={{ title: 'Scan Receipt', headerShown: false }} />
        {/* gestureEnabled: true so user is never trapped on this screen.
            If they swipe back, they return to camera. The navigation ref guard
            in processing.tsx prevents re-push if they come back here. */}
        <Stack.Screen name="processing" options={{ title: 'Processing', gestureEnabled: true }} />
        <Stack.Screen name="result" options={{
          title: 'Receipt Data',
          // Back button returns to Camera so user can retake the photo
          headerBackTitle: 'Retake',
        }} />
        <Stack.Screen name="invoice" options={{ title: 'Invoice' }} />
        <Stack.Screen name="history" options={{ title: 'Invoice History' }} />
      </Stack>
    </QueryClientProvider>
  );
}
