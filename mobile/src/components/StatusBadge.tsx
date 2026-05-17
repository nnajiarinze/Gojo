import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import type { ReceiptStatus } from '../types/api';
import type { FlowStep } from '../store/receiptStore';

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  idle: { label: 'Ready', color: '#6B7280' },
  capturing: { label: 'Image Captured', color: '#3B82F6' },
  uploading: { label: 'Uploading…', color: '#F59E0B' },
  processing: { label: 'Processing…', color: '#8B5CF6' },
  done: { label: 'Complete', color: '#10B981' },
  error: { label: 'Failed', color: '#EF4444' },
  uploaded: { label: 'Uploaded', color: '#3B82F6' },
  extracted: { label: 'Data Extracted', color: '#10B981' },
  reviewed: { label: 'Reviewed ✓', color: '#059669' },
  invoice_ready: { label: 'Invoice Ready', color: '#7C3AED' },
  invoiced: { label: 'Invoiced ✓', color: '#047857' },
  failed: { label: 'Failed', color: '#EF4444' },
};

interface StatusBadgeProps {
  status: FlowStep | ReceiptStatus;
  showSpinner?: boolean;
}

export function StatusBadge({ status, showSpinner }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle;
  const spinning = showSpinner ?? ['uploading', 'processing', 'uploaded'].includes(status);

  return (
    <View style={[styles.badge, { backgroundColor: cfg.color + '20' }]}>  
      {spinning && <ActivityIndicator size="small" color={cfg.color} style={styles.spinner} />}
      <Text style={[styles.text, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'center',
    marginVertical: 8,
  },
  spinner: { marginRight: 8 },
  text: { fontSize: 14, fontWeight: '600' },
});
