import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useReceiptStore } from '../src/store/receiptStore';
import { getInvoice, sendInvoiceEmail } from '../src/api/receipts';
import { ErrorState } from '../src/components/ErrorState';
import type { Invoice } from '../src/types/api';
import { downloadAndShareInvoicePdf } from '../src/services/invoicePdfDownload';

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
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    if (invoiceCreated?.invoiceId && !invoice) {
      fetchInvoice(invoiceCreated.invoiceId);
    }
  }, [invoiceCreated]);

  // Auto-poll while invoice is generating PDF
  useEffect(() => {
    if (!invoice || invoice.pdfStatus !== 'generating_pdf') return;
    const interval = setInterval(async () => {
      try {
        const updated = await getInvoice(invoice.id);
        if (updated.pdfStatus !== 'generating_pdf') {
          setInvoice(updated);
          clearInterval(interval);
          console.log(`[Invoice] PDF ready — pdfStatus: ${updated.pdfStatus}`);
        }
      } catch { /* ignore polling errors */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [invoice?.pdfStatus]);

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
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.successEmoji}>✅</Text>
        <Text style={styles.invoiceTitle}>FAKTURA</Text>
        <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
        {invoice.pdfStatus === 'generating_pdf' ? (
          <View style={styles.statusPill}>
            <ActivityIndicator size="small" color="#7C3AED" />
            <Text style={styles.statusPillText}>PDF genereras...</Text>
          </View>
        ) : (
          <View style={styles.statusPillReady}>
            <Text style={styles.statusPillReadyText}>Redo</Text>
          </View>
        )}
        <View style={invoice.paymentStatus === 'paid' ? styles.paymentPillPaid : styles.paymentPillUnpaid}>
          <Text style={invoice.paymentStatus === 'paid' ? styles.paymentPillPaidText : styles.paymentPillUnpaidText}>
            {invoice.paymentStatus === 'paid' ? 'Betald' : 'Obetald'}
          </Text>
        </View>
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

      {/* ─── Send Email Section ─── */}
      {(invoice.pdfStatus === 'ready' || invoice.pdfStatus === 'generating_pdf') && (
        <View style={styles.emailSection}>
          <Text style={styles.sectionTitle}>SKICKA FAKTURA VIA E-POST</Text>

          <Text style={styles.inputLabel}>Mottagarens namn</Text>
          <TextInput
            style={styles.input}
            placeholder="T.ex. Anna Andersson"
            placeholderTextColor="#9CA3AF"
            value={recipientName}
            onChangeText={(t) => { setRecipientName(t); setEmailError(null); }}
            autoCapitalize="words"
            returnKeyType="next"
          />

          <Text style={[styles.inputLabel, { marginTop: 12 }]}>E-postadress</Text>
          <TextInput
            style={styles.input}
            placeholder="namn@företag.se"
            placeholderTextColor="#9CA3AF"
            value={recipientEmail}
            onChangeText={(t) => { setRecipientEmail(t); setEmailError(null); }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
          />

          {emailError && (
            <Text style={styles.emailErrorText}>{emailError}</Text>
          )}

          <TouchableOpacity
            style={[
              styles.sendBtn,
              (!recipientName.trim() || !recipientEmail.trim() || sending) && styles.sendBtnDisabled,
            ]}
            onPress={async () => {
              // Validate
              const trimmedName = recipientName.trim();
              const trimmedEmail = recipientEmail.trim();
              if (!trimmedName) { setEmailError('Ange mottagarens namn.'); return; }
              if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
                setEmailError('Ange en giltig e-postadress.'); return;
              }
              setEmailError(null);
              setSending(true);
              try {
                await sendInvoiceEmail({
                  invoiceId: invoice.id,
                  to: trimmedEmail,
                  subject: `Faktura ${invoice.invoiceNumber} från ${invoice.legal?.companyName || 'Gojo'}`,
                  body: `Hej ${trimmedName},\n\nBifogat finner du faktura ${invoice.invoiceNumber} på ${invoice.currency} ${invoice.totalAmount.toFixed(2)}.\n\nMed vänlig hälsning,\n${invoice.legal?.companyName || 'Gojo'}`,
                });
                const updated = await getInvoice(invoice.id);
                setInvoice(updated);
                Alert.alert('Skickat!', `Faktura skickad till ${trimmedEmail}.`);
              } catch (err: any) {
                const msg = err?.response?.data?.error ?? err?.message ?? 'Kunde inte skicka';
                setEmailError(msg);
              } finally {
                setSending(false);
              }
            }}
            disabled={sending || !recipientName.trim() || !recipientEmail.trim()}
          >
            {sending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.sendBtnText}>
                {invoice.emailStatus === 'sent' ? '📧 Skicka igen' : '📧 Skicka faktura'}
              </Text>
            )}
          </TouchableOpacity>

          {invoice.emailStatus === 'sent' && invoice.sentAt && (
            <Text style={styles.sentInfo}>
              Skickad {new Date(invoice.sentAt).toLocaleDateString('sv-SE')}
            </Text>
          )}
        </View>
      )}

      {/* Download PDF */}
      <TouchableOpacity
        style={styles.pdfBtn}
        onPress={async () => {
          setGeneratingPdf(true);
          try {
            const uri = await downloadAndShareInvoicePdf(invoice);
            console.log(`[Invoice] PDF downloaded: ${uri}`);
          } catch (err: any) {
            console.error('[Invoice] PDF error:', err);
            Alert.alert('PDF-fel', err?.message ?? 'Kunde inte ladda ner PDF');
          } finally {
            setGeneratingPdf(false);
          }
        }}
        disabled={generatingPdf || invoice.pdfStatus === 'generating_pdf'}
      >
        {generatingPdf ? (
          <ActivityIndicator color="#fff" />
        ) : invoice.pdfStatus === 'generating_pdf' ? (
          <Text style={styles.pdfBtnText}>⏳ PDF genereras...</Text>
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


    </ScrollView>
    </KeyboardAvoidingView>
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
    marginTop: 16,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  sendBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  sentInfo: {
    textAlign: 'center',
    color: '#059669',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
  },
  emailSection: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
  },
  emailErrorText: {
    color: '#DC2626',
    fontSize: 13,
    marginTop: 8,
  },

  successEmoji: { fontSize: 32, marginBottom: 4 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F3E8FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginTop: 4 },
  statusPillText: { fontSize: 13, color: '#7C3AED', fontWeight: '600' },
  statusPillReady: { backgroundColor: '#D1FAE5', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginTop: 4 },
  statusPillReadyText: { fontSize: 13, color: '#065F46', fontWeight: '700' },
  paymentPillPaid: { backgroundColor: '#DCFCE7', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginTop: 8 },
  paymentPillPaidText: { fontSize: 13, color: '#166534', fontWeight: '800' },
  paymentPillUnpaid: { backgroundColor: '#FEE2E2', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginTop: 8 },
  paymentPillUnpaidText: { fontSize: 13, color: '#991B1B', fontWeight: '800' },
});
