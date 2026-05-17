import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { listInvoices, getInvoice } from '../src/api/receipts';
import { useReceiptStore } from '../src/store/receiptStore';
import type { Invoice } from '../src/types/api';

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  draft:          { label: 'Draft',      color: '#6B7280', bg: '#F3F4F6' },
  generating_pdf: { label: 'Generating', color: '#D97706', bg: '#FEF3C7' },
  ready:          { label: 'Ready',      color: '#059669', bg: '#D1FAE5' },
  sent:           { label: 'Sent',       color: '#7C3AED', bg: '#EDE9FE' },
  failed:         { label: 'Failed',     color: '#DC2626', bg: '#FEE2E2' },
};

export default function HistoryScreen() {
  const router = useRouter();
  const setInvoice = useReceiptStore((s) => s.setInvoice);
  const setInvoiceCreated = useReceiptStore((s) => s.setInvoiceCreated);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInvoices = useCallback(async () => {
    try {
      setError(null);
      const data = await listInvoices();
      setInvoices(data);
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? err?.message ?? 'Failed to load invoices';
      setError(msg);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchInvoices();
      setLoading(false);
    })();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchInvoices();
    setRefreshing(false);
  }, []);

  const openInvoice = useCallback(async (inv: Invoice) => {
    // Set store data so invoice.tsx can display it
    setInvoiceCreated({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      status: inv.status,
    });
    setInvoice(inv);
    router.push('/invoice');
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#7C3AED" />
        <Text style={styles.loadingText}>Loading invoices…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={fetchInvoices}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (invoices.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>📋</Text>
        <Text style={styles.emptyTitle}>No Invoices Yet</Text>
        <Text style={styles.emptySubtitle}>
          Scan a receipt and generate an invoice to see it here.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.listContent}
      data={invoices}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      renderItem={({ item }) => {
        const statusInfo = STATUS_LABELS[item.status] ?? STATUS_LABELS.draft;
        return (
          <TouchableOpacity
            style={styles.card}
            onPress={() => openInvoice(item)}
            activeOpacity={0.7}
          >
            <View style={styles.cardTop}>
              <Text style={styles.invoiceNumber}>{item.invoiceNumber}</Text>
              <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
                <Text style={[styles.statusText, { color: statusInfo.color }]}>
                  {statusInfo.label}
                </Text>
              </View>
            </View>
            <View style={styles.cardBottom}>
              <Text style={styles.date}>{item.issueDate}</Text>
              <Text style={styles.amount}>
                {item.currency} {item.totalAmount.toFixed(2)}
              </Text>
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  listContent: { padding: 16, paddingBottom: 40 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#F9FAFB',
  },
  loadingText: { marginTop: 16, fontSize: 15, color: '#6B7280' },
  errorText: { fontSize: 15, color: '#DC2626', textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    backgroundColor: '#111827',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 10,
  },
  retryText: { color: '#fff', fontWeight: '600' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },
  emptySubtitle: { fontSize: 14, color: '#6B7280', marginTop: 8, textAlign: 'center' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  invoiceNumber: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    fontFamily: 'monospace',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  date: { fontSize: 13, color: '#6B7280' },
  amount: { fontSize: 17, fontWeight: '700', color: '#111827' },
});
