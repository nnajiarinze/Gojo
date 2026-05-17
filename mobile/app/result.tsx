import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useReceiptStore } from '../src/store/receiptStore';
import { ReceiptDataView } from '../src/components/ReceiptDataView';
import { StatusBadge } from '../src/components/StatusBadge';
import { ErrorState } from '../src/components/ErrorState';
import {
  reviewReceipt,
  updateReceipt,
  generateInvoice,
  getReceipt,
} from '../src/api/receipts';
import type { LineItem } from '../src/types/api';
import { CONFIDENCE_HIGH, CONFIDENCE_MEDIUM } from '../src/services/receiptParser';

interface EditableLineItem {
  description: string;
  quantity: string;
  unitPrice: string;
}

export default function ResultScreen() {
  const router = useRouter();
  const receipt = useReceiptStore((s) => s.receipt);
  const parsedReceipt = useReceiptStore((s) => s.parsedReceipt);
  const parseResult = useReceiptStore((s) => s.parseResult);
  const setReceipt = useReceiptStore((s) => s.setReceipt);
  const setInvoiceCreated = useReceiptStore((s) => s.setInvoiceCreated);
  const reset = useReceiptStore((s) => s.reset);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const hydrated = useRef(false);

  // Editable fields — initialize from parsedReceipt if available
  const initialMerchant = (parsedReceipt?.merchantName || receipt?.merchantName) ?? '';
  const [merchantName, setMerchantName] = useState(initialMerchant);
  const [editItems, setEditItems] = useState<EditableLineItem[]>(() => {
    if (parsedReceipt && parsedReceipt.lineItems.length > 0) {
      return parsedReceipt.lineItems.map((li: any) => ({
        description: li.description,
        quantity: String(li.quantity),
        unitPrice: String(li.unitPrice),
      }));
    }
    return [];
  });

  // Auto-hydrate: when parsedReceipt arrives (possibly after receipt),
  // immediately update editable state so UI reflects parsed data.
  useEffect(() => {
    if (parsedReceipt && parsedReceipt.lineItems.length > 0 && !hydrated.current) {
      hydrated.current = true;
      const ts = Date.now();
      console.log(`[Result] AUTO-HYDRATE @ ${ts}: ${parsedReceipt.lineItems.length} items, VAT: ${parsedReceipt.vat} (${parsedReceipt.debug.vatSource}), Kontrollenhet: ${parsedReceipt.kontrollenhet || '(missing)'}`);
      setMerchantName(parsedReceipt.merchantName || receipt?.merchantName || '');
      setEditItems(
        parsedReceipt.lineItems.map((li: any) => ({
          description: li.description,
          quantity: String(li.quantity),
          unitPrice: String(li.unitPrice),
        }))
      );
    }
  }, [parsedReceipt]);

  const startEditing = useCallback(() => {
    if (!receipt) return;

    // editItems are already hydrated from parsedReceipt via auto-hydrate effect.
    // Only re-seed from backend if nothing was hydrated.
    if (editItems.length === 0) {
      console.log('[Result] Edit: seeding from backend data (no parsed data)');
      setMerchantName(receipt.merchantName ?? '');
      setEditItems(
        receipt.lineItems.map((li: any) => ({
          description: li.description,
          quantity: String(li.quantity),
          unitPrice: String(li.unitPrice),
        }))
      );
    } else {
      console.log(`[Result] Edit: using pre-hydrated data (${editItems.length} items)`);
    }
    setEditing(true);
  }, [receipt, editItems]);

  const updateLineItem = (index: number, field: keyof EditableLineItem, value: string) => {
    setEditItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addLineItem = () => {
    setEditItems((prev) => [...prev, { description: '', quantity: '1', unitPrice: '0' }]);
  };

  const removeLineItem = (index: number) => {
    setEditItems((prev) => prev.filter((_, i) => i !== index));
  };

  const computeTotal = (item: EditableLineItem): number => {
    const q = parseFloat(item.quantity) || 0;
    const p = parseFloat(item.unitPrice) || 0;
    return Math.round(q * p * 100) / 100;
  };

  const computeSubtotal = (): number => {
    return editItems.reduce((sum, item) => sum + computeTotal(item), 0);
  };

  const handleSaveEdits = useCallback(async () => {
    if (!receipt) return;
    if (editItems.length === 0) {
      Alert.alert('Error', 'At least one line item is required.');
      return;
    }
    for (const item of editItems) {
      if (!item.description.trim()) {
        Alert.alert('Error', 'All line items need a description.');
        return;
      }
    }
    setLoading(true);
    try {
      const updated = await updateReceipt(receipt.id, {
        merchantName: merchantName.trim(),
        lineItems: editItems.map((item) => ({
          description: item.description.trim(),
          quantity: parseFloat(item.quantity) || 0,
          unitPrice: parseFloat(item.unitPrice) || 0,
          total: computeTotal(item),
        })),
      });
      console.log(`[Result] Receipt saved & reviewed: ${updated.status}`);
      setReceipt(updated);
      setEditing(false);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.response?.data?.error ?? err.message;
      Alert.alert('Save Error', msg ?? 'Failed to save');
    } finally {
      setLoading(false);
    }
  }, [receipt, merchantName, editItems]);

  const handleConfirmReview = useCallback(async () => {
    if (!receipt) return;
    setLoading(true);
    try {
      // FIX: Fetch fresh receipt before attempting state transition.
      // The Zustand receipt can be stale if the user navigated back and forth,
      // or if a previous Save & Review already moved it to 'reviewed'.
      // Without this check, we'd call POST /review on an already-reviewed
      // receipt, causing "Invalid state transition" error.
      const fresh = await getReceipt(receipt.id);
      if (fresh.status !== 'extracted') {
        console.log(`[Result] Receipt already ${fresh.status}, skipping review call`);
        setReceipt(fresh);
        return;
      }
      await reviewReceipt(receipt.id);
      console.log(`[Result] Receipt ${receipt.id} reviewed`);
      const updated = await getReceipt(receipt.id);
      setReceipt(updated);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? err.message ?? 'Failed to review');
    } finally {
      setLoading(false);
    }
  }, [receipt]);

  const handleGenerateInvoice = useCallback(async () => {
    if (!receipt) return;

    // ── Build final reviewed line items from editable state ──
    const finalLineItems = editItems.map((item) => ({
      description: item.description.trim(),
      quantity: parseFloat(item.quantity) || 0,
      unitPrice: parseFloat(item.unitPrice) || 0,
      total: computeTotal(item),
    }));

    // ── Validation: block if data looks like mock/seed ──
    const mockCustomerId = '00000000-0000-0000-0000-000000000001';
    if (finalLineItems.length === 0) {
      Alert.alert('Error', 'Cannot generate invoice with zero line items.');
      return;
    }

    // ── Block invoice generation on low confidence without manual review ──
    if (confidence < CONFIDENCE_MEDIUM && !editing) {
      Alert.alert(
        'Låg konfidens',
        'Parsningsresultatet har låg konfidens. Redigera och granska datan innan fakturan skapas.',
        [{ text: 'OK' }]
      );
      return;
    }

    for (const li of finalLineItems) {
      if (li.total <= 0 || !li.description) {
        Alert.alert('Error', `Invalid line item: "${li.description || '(empty)'}". All items must have a description and positive total.`);
        return;
      }
    }

    // ── Build legal metadata from parsed OCR ──
    const legal = parsedReceipt ? {
      kontrollenhet: parsedReceipt.kontrollenhet || '',
      orgNumber: parsedReceipt.merchantLegalInfo?.orgNumber || '',
      companyName: parsedReceipt.merchantLegalInfo?.companyName || '',
      address: parsedReceipt.merchantLegalInfo?.address || '',
    } : undefined;

    // ── Debug: confirm data source ──
    const reviewedSubtotal = finalLineItems.reduce((s, li) => s + li.total, 0);
    const vatValue = parsedReceipt?.vat ?? null;
    console.log('[Invoice] ═══ GENERATE INVOICE INPUT ═══');
    console.log(`[Invoice] Source: finalReviewedReceiptState (editItems)`);
    console.log(`[Invoice] Line items: ${finalLineItems.length}`);
    console.log(`[Invoice] Subtotal (reviewed): ${reviewedSubtotal.toFixed(2)}`);
    console.log(`[Invoice] VAT (MOMS): ${vatValue} (source: ${parsedReceipt?.debug?.vatSource ?? 'n/a'})`);
    console.log(`[Invoice] Kontrollenhet: ${legal?.kontrollenhet || '(missing)'}`);
    console.log(`[Invoice] Merchant: ${merchantName}`);
    if (legal) {
      console.log(`[Invoice] Legal: ${JSON.stringify(legal)}`);
      if (!legal.kontrollenhet) console.warn('[Invoice] ⚠ Missing Kontrollenhet');
      if (!legal.orgNumber) console.warn('[Invoice] ⚠ Missing OrgNumber');
    } else {
      console.warn('[Invoice] ⚠ No parsed receipt — legal metadata missing');
    }
    console.log('[Invoice] ═══════════════════════════════');

    setLoading(true);
    try {
      // Refresh receipt to ensure it's still in 'reviewed' status
      const fresh = await getReceipt(receipt.id);
      if (fresh.status !== 'reviewed') {
        console.log(`[Invoice] Receipt is ${fresh.status}, not reviewed — updating UI`);
        setReceipt(fresh);
        setLoading(false);
        return;
      }

      // Compute actual tax rate from receipt values
      const computedTaxRate = (parsedReceipt?.vat && parsedReceipt?.subtotal && parsedReceipt.subtotal > 0)
        ? Math.round((parsedReceipt.vat / parsedReceipt.subtotal) * 10000) / 100
        : 25; // fallback to Swedish standard 25%

      const res = await generateInvoice({
        receiptId: receipt.id,
        customerId: mockCustomerId,
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        taxRate: computedTaxRate,
        taxAmount: parsedReceipt?.vat ?? undefined,
        subtotal: parsedReceipt?.subtotal ?? undefined,
        totalAmount: parsedReceipt?.totalAmount ?? undefined,
        lineItems: finalLineItems,
        legal,
      });
      console.log(`[Invoice] Invoice created: ${res.invoiceNumber}`);
      setInvoiceCreated(res);
      console.log('[Invoice] NAV: push /invoice');
      router.push('/invoice');
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.response?.data?.error ?? err.message;
      Alert.alert('Invoice Error', msg ?? 'Failed to generate invoice');
    } finally {
      setLoading(false);
    }
  }, [receipt, editItems, merchantName, parsedReceipt]);

  if (!receipt) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No receipt data available.</Text>
      </View>
    );
  }

  const status = receipt.status;

  // ── EDIT MODE ──
  if (editing) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <StatusBadge status="extracted" />
        <Text style={styles.editTitle}>Edit Receipt</Text>

        <View style={styles.editCard}>
          <Text style={styles.editLabel}>Merchant Name</Text>
          <TextInput
            style={styles.input}
            value={merchantName}
            onChangeText={setMerchantName}
            placeholder="Restaurant name"
          />
        </View>

        <View style={styles.editCard}>
          <Text style={styles.editSectionTitle}>Line Items</Text>
          {editItems.map((item, i) => (
            <View key={i} style={styles.editLineItem}>
              <TextInput
                style={[styles.input, styles.descInput]}
                value={item.description}
                onChangeText={(v) => updateLineItem(i, 'description', v)}
                placeholder="Description"
              />
              <View style={styles.editRow}>
                <View style={styles.editCol}>
                  <Text style={styles.editMiniLabel}>Qty</Text>
                  <TextInput
                    style={styles.inputSmall}
                    value={item.quantity}
                    onChangeText={(v) => updateLineItem(i, 'quantity', v)}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.editCol}>
                  <Text style={styles.editMiniLabel}>Price (SEK)</Text>
                  <TextInput
                    style={styles.inputSmall}
                    value={item.unitPrice}
                    onChangeText={(v) => updateLineItem(i, 'unitPrice', v)}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.editCol}>
                  <Text style={styles.editMiniLabel}>Total</Text>
                  <Text style={styles.computedTotal}>
                    SEK {computeTotal(item).toFixed(2)}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => removeLineItem(i)} style={styles.removeBtn}>
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <TouchableOpacity style={styles.addItemBtn} onPress={addLineItem}>
            <Text style={styles.addItemText}>+ Add Item</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.editCard}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>SEK {computeSubtotal().toFixed(2)}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.button, styles.reviewBtn]}
          onPress={handleSaveEdits}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Save & Review</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryBtn]}
          onPress={() => setEditing(false)}
        >
          <Text style={styles.secondaryBtnText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Confidence level ──
  const confidence = parseResult?.confidence ?? parsedReceipt?.confidence ?? 0;
  const isLowConfidence = confidence < CONFIDENCE_MEDIUM;
  const isMediumConfidence = confidence >= CONFIDENCE_MEDIUM && confidence < CONFIDENCE_HIGH;

  // ── Parser failure state (local OCR failed to extract data) ──
  const parserFailed = parseResult && !parseResult.success;

  // ── VIEW MODE ──
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <StatusBadge status={status} />

      {/* Parser failure UI — shows when local OCR couldn't parse the receipt */}
      {parserFailed && status !== 'failed' && status !== 'invoiced' && (
        <View style={styles.parseFailCard}>
          <Text style={styles.parseFailIcon}>⚠️</Text>
          <Text style={styles.parseFailTitle}>Kunde inte tolka kvittot</Text>
          <Text style={styles.parseFailMessage}>{parseResult.reason}</Text>
          {parseResult.partialData && (
            <View style={styles.partialDataSection}>
              <Text style={styles.partialDataLabel}>Delvis data:</Text>
              {parseResult.partialData.merchantName && (
                <Text style={styles.partialDataItem}>• Butik: {parseResult.partialData.merchantName}</Text>
              )}
              {parseResult.partialData.totalAmount && (
                <Text style={styles.partialDataItem}>• Total: {parseResult.partialData.totalAmount} SEK</Text>
              )}
              {parseResult.partialData.kontrollenhet && (
                <Text style={styles.partialDataItem}>• Kontrollenhet: {parseResult.partialData.kontrollenhet}</Text>
              )}
            </View>
          )}
          <View style={styles.parseFailActions}>
            <TouchableOpacity
              style={[styles.button, styles.editBtn]}
              onPress={() => {
                // Prefill from partial data if available
                if (parseResult.partialData?.merchantName) {
                  setMerchantName(parseResult.partialData.merchantName);
                }
                setEditing(true);
              }}
            >
              <Text style={styles.buttonText}>Fyll i manuellt</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.secondaryBtn]}
              onPress={() => {
                reset();
                router.dismissAll();
              }}
            >
              <Text style={styles.secondaryBtnText}>Försök igen</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Confidence warning banner */}
      {!parserFailed && isMediumConfidence && status !== 'failed' && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>
            ⚠️ Kontrollera uppgifterna innan fakturan skapas (konfidens: {Math.round(confidence * 100)}%)
          </Text>
        </View>
      )}

      {/* Low confidence block */}
      {!parserFailed && isLowConfidence && parsedReceipt && status !== 'failed' && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>
            🚫 Låg konfidens ({Math.round(confidence * 100)}%) — granska och redigera innan faktura kan skapas
          </Text>
        </View>
      )}

      {status === 'failed' && (
        <ErrorState
          message="Processing failed."
          onRetry={() => {
            console.log('[Result] NAV: dismissAll (user action: retry after failure)');
            reset();
            router.dismissAll();
          }}
        />
      )}

      {!parserFailed && ['extracted', 'reviewed', 'invoice_ready', 'invoiced'].includes(status) && (
        <ReceiptDataView receipt={receipt} parsedReceipt={parsedReceipt} />
      )}

      {status === 'extracted' && !parserFailed && (
        <>
          <TouchableOpacity
            style={[styles.button, styles.editBtn]}
            onPress={startEditing}
          >
            <Text style={styles.buttonText}>Edit Receipt</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.reviewBtn]}
            onPress={handleConfirmReview}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Confirm & Review</Text>
            )}
          </TouchableOpacity>
        </>
      )}

      {status === 'reviewed' && (
        <TouchableOpacity
          style={[styles.button, styles.invoiceBtn]}
          onPress={handleGenerateInvoice}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Generate Invoice</Text>
          )}
        </TouchableOpacity>
      )}

      {status === 'invoice_ready' && (
        <View style={styles.successCard}>
          <Text style={styles.successIcon}>📋</Text>
          <Text style={styles.successTitle}>Invoice Ready</Text>
        </View>
      )}

      {status === 'invoiced' && (
        <View style={styles.successCard}>
          <Text style={styles.successIcon}>✅</Text>
          <Text style={styles.successTitle}>Invoice Created!</Text>
          <TouchableOpacity
            style={[styles.button, styles.invoiceBtn]}
            onPress={() => {
              console.log('[Result] NAV: push /invoice (user action: view invoice)');
              router.push('/invoice');
            }}
          >
            <Text style={styles.buttonText}>View Invoice</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={[styles.button, styles.secondaryBtn]}
        onPress={() => {
          console.log('[Result] NAV: dismissAll (user action: scan another)');
          reset();
          router.dismissAll();
        }}
      >
        <Text style={styles.secondaryBtnText}>Scan Another</Text>
      </TouchableOpacity>

      <Text style={styles.debug}>
        Status: {status} | ID: {receipt.id.slice(0, 8)}…
      </Text>

      {/* Parse diagnostics */}
      {parsedReceipt && (
        <View style={styles.debugCard}>
          <Text style={styles.debugTitle}>🔍 Analysinfo</Text>
          <Text style={styles.debugText}>
            Källa: lokal OCR | {parsedReceipt.lineItems.length} rader | {parsedReceipt.debug.durationMs}ms
          </Text>
          <Text style={styles.debugText}>
            Moms: {parsedReceipt.vat ?? '—'} ({parsedReceipt.debug.vatSource})
          </Text>
          {parsedReceipt.debug.warnings.length > 0 && (
            <Text style={styles.debugWarn}>
              ⚠️ {parsedReceipt.debug.warnings.join('\n⚠️ ')}
            </Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { paddingBottom: 60 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  emptyText: { fontSize: 16, color: '#6B7280' },
  button: { marginHorizontal: 20, marginTop: 16, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  editBtn: { backgroundColor: '#3B82F6' },
  reviewBtn: { backgroundColor: '#059669' },
  invoiceBtn: { backgroundColor: '#7C3AED' },
  secondaryBtn: { backgroundColor: '#F3F4F6', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryBtnText: { color: '#374151', fontSize: 16, fontWeight: '600' },
  successCard: { alignItems: 'center', padding: 32, marginHorizontal: 20, marginTop: 20, backgroundColor: '#ECFDF5', borderRadius: 16 },
  successIcon: { fontSize: 48, marginBottom: 12 },
  successTitle: { fontSize: 20, fontWeight: '700', color: '#065F46' },
  debug: { marginTop: 24, fontSize: 11, color: '#9CA3AF', textAlign: 'center', fontFamily: 'monospace' },
  // Edit mode
  editTitle: { fontSize: 18, fontWeight: '700', color: '#111827', textAlign: 'center', marginTop: 8, marginBottom: 4 },
  editCard: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 12, padding: 16, borderRadius: 12 },
  editLabel: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginBottom: 6 },
  editSectionTitle: { fontSize: 13, fontWeight: '700', color: '#9CA3AF', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, fontSize: 15, color: '#111827', backgroundColor: '#F9FAFB' },
  descInput: { marginBottom: 8 },
  editLineItem: { marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  editRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  editCol: { flex: 1 },
  editMiniLabel: { fontSize: 11, color: '#9CA3AF', marginBottom: 4 },
  inputSmall: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 8, fontSize: 14, color: '#111827', backgroundColor: '#F9FAFB', textAlign: 'center' },
  computedTotal: { fontSize: 14, fontWeight: '600', color: '#111827', textAlign: 'center', paddingVertical: 10 },
  removeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },
  removeBtnText: { color: '#EF4444', fontWeight: '700', fontSize: 14 },
  addItemBtn: { marginTop: 8, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#D1D5DB', borderStyle: 'dashed', alignItems: 'center' },
  addItemText: { color: '#6B7280', fontWeight: '600' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  totalLabel: { fontSize: 17, fontWeight: '700', color: '#111827' },
  totalValue: { fontSize: 17, fontWeight: '700', color: '#111827' },
  // Debug OCR section
  debugCard: { backgroundColor: '#FEF3C7', marginHorizontal: 16, marginTop: 16, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#FDE68A' },
  debugTitle: { fontSize: 13, fontWeight: '700', color: '#92400E', marginBottom: 6 },
  debugText: { fontSize: 11, color: '#78350F', fontFamily: 'monospace', marginBottom: 2 },
  debugItem: { fontSize: 11, color: '#92400E', fontFamily: 'monospace', marginLeft: 8, marginBottom: 1 },
  debugWarn: { fontSize: 10, color: '#B45309', fontFamily: 'monospace', marginTop: 6 },
  // Parser failure UI
  parseFailCard: { alignItems: 'center', padding: 24, marginHorizontal: 16, marginTop: 16, backgroundColor: '#FEF2F2', borderRadius: 16, borderWidth: 1, borderColor: '#FECACA' },
  parseFailIcon: { fontSize: 40, marginBottom: 8 },
  parseFailTitle: { fontSize: 18, fontWeight: '700', color: '#991B1B', marginBottom: 8 },
  parseFailMessage: { fontSize: 14, color: '#7F1D1D', textAlign: 'center', marginBottom: 16, lineHeight: 20 },
  partialDataSection: { backgroundColor: '#FFF7ED', padding: 12, borderRadius: 8, width: '100%', marginBottom: 16 },
  partialDataLabel: { fontSize: 12, fontWeight: '700', color: '#9A3412', marginBottom: 4 },
  partialDataItem: { fontSize: 13, color: '#7C2D12', marginBottom: 2 },
  parseFailActions: { width: '100%' },
  // Confidence warning banner
  warningBanner: { backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 10, marginHorizontal: 16, marginTop: 12, padding: 12 },
  warningText: { fontSize: 13, color: '#92400E', textAlign: 'center', fontWeight: '500' },
});
