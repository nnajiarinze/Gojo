import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useReceiptStore } from '../src/store/receiptStore';
import { useUploadReceipt } from '../src/hooks/useUploadReceipt';
import { useReceiptPolling } from '../src/hooks/useReceiptPolling';
import { StatusBadge } from '../src/components/StatusBadge';
import { ErrorState } from '../src/components/ErrorState';

export default function ProcessingScreen() {
  const router = useRouter();
  const { step, error, imageUri, receiptId, receipt } = useReceiptStore();
  const reset = useReceiptStore((s) => s.reset);
  const { upload } = useUploadReceipt();

  // Track the previous step so we only navigate on a real TRANSITION,
  // not when the component mounts with stale step='done' from a previous flow.
  //
  // ROOT CAUSE OF THE BUG:
  // The old code used useRef(false) as a guard, but refs reset on remount.
  // When the user pressed back to this screen, the component remounted,
  // the ref was false again, step was already 'done' in Zustand, and the
  // useEffect immediately pushed to /result — trapping the user in a loop.
  //
  // NEW APPROACH: We record the step value at mount time. We only navigate
  // when step changes FROM a non-done value TO 'done' during this mount.
  // If step is already 'done' when we mount (back-navigation), we do nothing.
  const stepAtMount = useRef(step);
  const hasNavigated = useRef(false);

  console.log(`[Processing] Render — step: ${step}, stepAtMount: ${stepAtMount.current}, hasNavigated: ${hasNavigated.current}`);

  // Start upload when entering screen
  useEffect(() => {
    if (imageUri && step === 'capturing') {
      console.log('[Processing] Starting upload');
      upload(imageUri);
    }
  }, [imageUri, step]);

  // Poll for status updates — polling ONLY updates Zustand store,
  // it NEVER triggers navigation. Navigation is screen-owned.
  useReceiptPolling(receiptId);

  // Navigate to result ONLY on a genuine transition: step was NOT 'done'
  // at mount time, and has now become 'done'. This prevents the loop.
  useEffect(() => {
    if (
      step === 'done' &&
      receipt &&
      !hasNavigated.current &&
      stepAtMount.current !== 'done' // <-- key guard: skip if already done on mount
    ) {
      hasNavigated.current = true;
      console.log(`[Processing] TRANSITION detected (${stepAtMount.current} → done), navigating to /result, status: ${receipt.status}`);
      // Replace: processing is a transient waiting screen. It should not
      // remain in the back stack. Back from Result goes straight to Home.
      router.replace('/result');
    } else if (step === 'done' && stepAtMount.current === 'done') {
      // User navigated back to this screen — step was already 'done'.
      // Do NOT push forward. Let the user use the back button normally.
      console.log('[Processing] Step already done on mount — NOT navigating (back-nav safe)');
    }
  }, [step, receipt]);

  if (step === 'error') {
    return (
      <View style={styles.container}>
        <ErrorState
          message={error ?? 'Something went wrong'}
          onRetry={() => {
            console.log('[Processing] Error retry — resetting and going back');
            reset();
            router.back();
          }}
        />
      </View>
    );
  }

  // If user navigated back here after processing is complete,
  // show a helpful message instead of a perpetual spinner.
  if (step === 'done' && receipt) {
    return (
      <View style={styles.container}>
        <Text style={styles.hint}>Processing complete.</Text>
        <Text style={styles.debug}>
          Use the back button or navigate forward.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#111827" style={styles.spinner} />
      <StatusBadge status={step} />
      <Text style={styles.hint}>
        {step === 'uploading' && 'Uploading receipt image…'}
        {step === 'processing' && 'Extracting receipt data…'}
        {step === 'idle' && 'Initializing…'}
      </Text>
      {receiptId && (
        <Text style={styles.debug}>ID: {receiptId.slice(0, 8)}…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#F9FAFB',
  },
  spinner: { marginBottom: 24 },
  hint: {
    marginTop: 16,
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
  },
  debug: {
    marginTop: 24,
    fontSize: 12,
    color: '#9CA3AF',
    fontFamily: 'monospace',
  },
});
