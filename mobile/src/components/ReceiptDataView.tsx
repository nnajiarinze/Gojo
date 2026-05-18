import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Receipt } from '../types/api';
import type { ParsedReceipt } from '../services/receiptParser';

interface ReceiptDataViewProps {
  receipt: Receipt;
  parsedReceipt?: ParsedReceipt | null;
}

/**
 * Displays receipt data. When parsedReceipt (local OCR) is available,
 * it is used as the PRIMARY data source for line items, totals, and
 * legal metadata. Backend receipt is used only as fallback.
 */
export function ReceiptDataView({ receipt, parsedReceipt }: ReceiptDataViewProps) {
  const hasParsed = !!(parsedReceipt && parsedReceipt.lineItems.length > 0);
  const merchantName = (hasParsed ? parsedReceipt!.merchantName : null) || receipt.merchantName;
  const currency = hasParsed ? parsedReceipt!.currency : receipt.currency;
  const lineItems = hasParsed
    ? parsedReceipt!.lineItems.map((li: any, i: number) => ({ ...li, id: `parsed-${i}`, sortOrder: i }))
    : receipt.lineItems;
  const subtotal = hasParsed ? parsedReceipt!.subtotal : receipt.subtotal;
  const vat = hasParsed ? parsedReceipt!.vat : receipt.taxAmount;
  const totalAmount = hasParsed ? parsedReceipt!.totalAmount : receipt.totalAmount;
  const confidence = hasParsed ? parsedReceipt!.confidence : receipt.confidence;
  const vatSource = hasParsed ? parsedReceipt!.debug.vatSource : 'backend';

  const kontrollenhet = parsedReceipt?.kontrollenhet || '';
  const legal = parsedReceipt?.merchantLegalInfo;

  console.log(`[ReceiptDataView] Hydrating — source: ${hasParsed ? 'LOCAL_OCR' : 'BACKEND'}, items: ${lineItems.length}, VAT: ${vat} (${vatSource}), Kontrollenhet: ${kontrollenhet || '(missing)'}`);

  return (
    <View style={styles.container}>
      {hasParsed && (
        <View style={styles.sourceTag}>
          <Text style={styles.sourceTagText}>📱 Lokal OCR-analys</Text>
        </View>
      )}

      <Field label="Restaurang" value={merchantName} />
      <Field label="Datum" value={receipt.receiptDate} />
      <Field label="Valuta" value={currency} />

      <View style={styles.divider} />

      {lineItems.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>RADER</Text>
          {lineItems.map((item: any, i: number) => (
            <View key={item.id ?? i} style={styles.lineItem}>
              <Text style={styles.lineDesc} numberOfLines={1}>
                {item.description}
              </Text>
              <Text style={styles.lineQty}>×{item.quantity}</Text>
              <Text style={styles.linePrice}>{currency} {item.total.toFixed(2)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
        </>
      )}

      <Field label="Netto" value={fmtC(currency, subtotal)} />
      <Field label="MOMS-sats" value={subtotal && vat && subtotal > 0 ? `${Math.round((vat / subtotal) * 10000) / 100}%` : '—'} />
      <Field label={`MOMS-belopp (${vatSource})`} value={fmtC(currency, vat)} />
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Totalt</Text>
        <Text style={styles.totalValue}>{fmtC(currency, totalAmount)}</Text>
      </View>

      {(kontrollenhet || legal?.companyName) && (
        <>
          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>JURIDISK INFORMATION</Text>
          {legal?.companyName ? <Field label="Företag" value={legal.companyName} /> : null}
          {legal?.orgNumber ? <Field label="Org.nr" value={legal.orgNumber} /> : null}
          {legal?.address ? <Field label="Adress" value={legal.address} /> : null}
          {kontrollenhet ? (
            <Field label="Kontrollenhet" value={kontrollenhet} />
          ) : (
            <View style={styles.warningRow}>
              <Text style={styles.warningText}>⚠ Kontrollenhet saknas</Text>
            </View>
          )}
        </>
      )}

      {!kontrollenhet && !legal?.companyName && parsedReceipt && (
        <View style={styles.warningRow}>
          <Text style={styles.warningText}>⚠ Kontrollenhet saknas — juridisk metadata ej hittad</Text>
        </View>
      )}

      {confidence != null && (
        <Text style={styles.confidence}>
          Konfidens: {Math.round(confidence * 100)}%
        </Text>
      )}
    </View>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value ?? '—'}</Text>
    </View>
  );
}

function fmtC(currency: string, n: number | null | undefined): string {
  if (n == null) return '—';
  return `${currency} ${n.toFixed(2)}`;
}

const styles = StyleSheet.create({
  container: { padding: 20 },
  sourceTag: {
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  sourceTagText: { fontSize: 11, fontWeight: '600', color: '#1D4ED8' },
  field: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  fieldLabel: { fontSize: 15, color: '#6B7280' },
  fieldValue: { fontSize: 15, fontWeight: '500', color: '#111827', flexShrink: 1, textAlign: 'right' },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  lineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  lineDesc: { flex: 1, fontSize: 14, color: '#111827' },
  lineQty: { fontSize: 14, color: '#6B7280', marginHorizontal: 12 },
  linePrice: { fontSize: 14, fontWeight: '500', color: '#111827', width: 90, textAlign: 'right' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  totalLabel: { fontSize: 17, fontWeight: '700', color: '#111827' },
  totalValue: { fontSize: 17, fontWeight: '700', color: '#111827' },
  warningRow: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 8,
  },
  warningText: { fontSize: 12, color: '#92400E', fontWeight: '600' },
  confidence: {
    marginTop: 16,
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
  },
});
