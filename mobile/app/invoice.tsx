import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useReceiptStore } from '../src/store/receiptStore';
import { getInvoice, sendInvoiceEmail } from '../src/api/receipts';
import { StatusBadge } from '../src/components/StatusBadge';
import { ErrorState } from '../src/components/ErrorState';
import type { Invoice } from '../src/types/api';
import { generateAndShareInvoicePdf } from '../src/services/invoicePdf';

export default function InvoiceScreen() {
  const router = useRouter();
  const invoiceCreated = useReceiptStore((s) => s.invoiceCreated);
  const invoice = useReceiptStore((s) => s.invoice);
  const setInvoice = useReceiptStore((s) => s.setInvoice);
  const reset = useReceiptStore((s) => s.reset);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (invoiceCreated?.invoiceId && !invoice) {
      fetchInvoice(invoiceCreated.invoiceId);
    }
  }, [invoiceCreated]);

  async function fetchInvoice(invoiceId: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await getInvoice(invoiceId);
      setInvoice(data);
      console.log(`[Invoice] Fetched invoice: ${data.invoiceNumber}`);
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? err?.message ?? 'Failed to load invoice';
      console.error('[Invoice] Fetch error:', msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#7C3AED" />
        <Text style={styles.loadingText}>Loading invoice…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <ErrorState
          message={error}
          onRetry={() => invoiceCreated && fetchInvoice(invoiceCreated.invoiceId)}
        />
      </View>
    );
  }

  if (!invoice) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>No invoice data available.</Text>
        <TouchableOpacity style={styles.homeBtn} onPress={() => {
          console.log('[Invoice] NAV: dismissAll (user action: go home, no invoice)');
          reset();
          router.dismissAll();
        }}>
          <Text style={styles.homeBtnText}>Go Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.invoiceTitle}>FAKTURA</Text>
        <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
        <StatusBadge status="invoiced" />
      </View>

      {/* Restaurant / Legal info */}
      <View style={styles.card}>
        <Text style={styles.restaurantName}>{invoice.legal?.companyName || 'Gojo Restaurant'}</Text>
        {invoice.legal?.orgNumber ? (
          <Text style={styles.restaurantDetail}>Organisationsnummer: {invoice.legal.orgNumber}</Text>
        ) : null}
        {invoice.legal?.address ? (
          <Text style={styles.restaurantDetail}>{invoice.legal.address}</Text>
        ) : (
          <Text style={styles.restaurantDetail}>Stockholm, Sverige</Text>
        )}
        {invoice.legal?.kontrollenhet ? (
          <Text style={styles.restaurantDetail}>Kontrollenhet: {invoice.legal.kontrollenhet}</Text>
        ) : null}
      </View>

      {/* Dates */}
      <View style={styles.row}>
        <View style={styles.dateCol}>
          <Text style={styles.dateLabel}>Fakturadatum</Text>
          <Text style={styles.dateValue}>{invoice.issueDate}</Text>
        </View>
        <View style={styles.dateCol}>
          <Text style={styles.dateLabel}>Förfallodatum</Text>
          <Text style={styles.dateValue}>{invoice.dueDate}</Text>
        </View>
      </View>

      {/* Line items */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>RADER</Text>
        {invoice.lineItems.map((item, i) => (
          <View key={item.id ?? i} style={styles.lineItem}>
            <View style={styles.lineLeft}>
              <Text style={styles.lineDesc}>{item.description}</Text>
              <Text style={styles.lineQty}>
                {item.quantity} × {invoice.currency} {item.unitPrice.toFixed(2)}
              </Text>
            </View>
            <Text style={styles.lineTotal}>
              {invoice.currency} {item.total.toFixed(2)}
            </Text>
          </View>
        ))}
      </View>

      {/* Totals */}
      <View style={styles.totalsCard}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Netto</Text>
          <Text style={styles.totalValue}>{invoice.currency} {invoice.subtotal.toFixed(2)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Moms ({invoice.taxRate}%)</Text>
          <Text style={styles.totalValue}>{invoice.currency} {invoice.taxAmount.toFixed(2)}</Text>
        </View>
        <View style={[styles.totalRow, styles.grandTotal]}>
          <Text style={styles.grandTotalLabel}>Totalt</Text>
          <Text style={styles.grandTotalValue}>
            {invoice.currency} {invoice.totalAmount.toFixed(2)}
          </Text>
        </View>
      </View>

      {/* Notes */}
      {invoice.notes && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>ANTECKNINGAR</Text>
          <Text style={styles.notes}>{invoice.notes}</Text>
        </View>
      )}

      {/* Send Email — available when invoice PDF is ready */}
      {(invoice.status === 'ready' || invoice.status === 'sent') && (
        <TouchableOpacity
          style={styles.sendBtn}
          onPress={async () => {
            setSending(true);
            try {
              await sendInvoiceEmail({
                invoiceId: invoice.id,
                to: 'customer@gojo.dev',
                subject: `Invoice ${invoice.invoiceNumber}`,
                body: `Please find attached invoice ${invoice.invoiceNumber} for ${invoice.currency} ${invoice.totalAmount.toFixed(2)}.`,
              });
              // Refresh invoice to show updated status
              const updated = await getInvoice(invoice.id);
              setInvoice(updated);
              Alert.alert('Sent!', `Invoice emailed successfully.`);
            } catch (err: any) {
              const msg = err?.response?.data?.error ?? err?.message ?? 'Failed to send';
              Alert.alert('Send Error', msg);
            } finally {
              setSending(false);
            }
          }}
          disabled={sending}
        >
          {sending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.sendBtnText}>
              {invoice.status === 'sent' ? '📧 Resend Email' : '📧 Send Email'}
            </Text>
          )}
        </TouchableOpacity>
      )}

      {invoice.status === 'sent' && invoice.sentAt && (
        <Text style={styles.sentInfo}>
          Sent on {new Date(invoice.sentAt).toLocaleDateString()}
        </Text>
      )}

      {/* Download PDF */}
      <TouchableOpacity
        style={styles.pdfBtn}
        onPress={async () => {
          setGeneratingPdf(true);
          try {
            const uri = await generateAndShareInvoicePdf(invoice);
            console.log(`[Invoice] PDF shared: ${uri}`);
          } catch (err: any) {
            console.error('[Invoice] PDF error:', err);
            Alert.alert('PDF-fel', err?.message ?? 'Kunde inte skapa PDF');
          } finally {
            setGeneratingPdf(false);
          }
        }}
        disabled={generatingPdf}
      >
        {generatingPdf ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.pdfBtnText}>📄 Ladda ner PDF</Text>
        )}
      </TouchableOpacity>

      {/* Actions */}
      <TouchableOpacity
        style={styles.homeBtn}
        onPress={() => {
          console.log('[Invoice] NAV: dismissAll (user action: done, scan another)');
          reset();
          router.dismissAll();
        }}
      >
        <Text style={styles.homeBtnText}>Done — Scan Another</Text>
      </TouchableOpacity>

      <Text style={styles.debug}>
        Invoice ID: {invoice.id?.slice(0, 8)}… | Status: {invoice.status}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { paddingBottom: 60 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#F9FAFB',
  },
  loadingText: { marginTop: 16, fontSize: 15, color: '#6B7280' },
  emptyText: { fontSize: 16, color: '#6B7280', marginBottom: 20 },
  header: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 16,
  },
  invoiceTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#9CA3AF',
  },
  invoiceNumber: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    marginTop: 4,
    marginBottom: 8,
    fontFamily: 'monospace',
  },
  card: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  restaurantName: { fontSize: 18, fontWeight: '700', color: '#111827' },
  restaurantDetail: { fontSize: 14, color: '#6B7280', marginTop: 2 },
  row: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    gap: 12,
  },
  dateCol: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 10,
  },
  dateLabel: { fontSize: 11, color: '#9CA3AF', fontWeight: '600', textTransform: 'uppercase' },
  dateValue: { fontSize: 15, fontWeight: '600', color: '#111827', marginTop: 4 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 1,
    marginBottom: 12,
  },
  lineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  lineLeft: { flex: 1 },
  lineDesc: { fontSize: 15, fontWeight: '500', color: '#111827' },
  lineQty: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  lineTotal: { fontSize: 15, fontWeight: '600', color: '#111827' },
  totalsCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  totalLabel: { fontSize: 15, color: '#6B7280' },
  totalValue: { fontSize: 15, fontWeight: '500', color: '#111827' },
  grandTotal: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    marginTop: 8,
    paddingTop: 12,
  },
  grandTotalLabel: { fontSize: 18, fontWeight: '700', color: '#111827' },
  grandTotalValue: { fontSize: 18, fontWeight: '700', color: '#7C3AED' },
  notes: { fontSize: 14, color: '#374151', lineHeight: 20 },
  homeBtn: {
    backgroundColor: '#111827',
    marginHorizontal: 16,
    marginTop: 24,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  homeBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  pdfBtn: {
    backgroundColor: '#059669',
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  pdfBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  sendBtn: {
    backgroundColor: '#7C3AED',
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  sendBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  sentInfo: {
    textAlign: 'center',
    color: '#059669',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
  },
  debug: {
    marginTop: 16,
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
    fontFamily: 'monospace',
  },
});
